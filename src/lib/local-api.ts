import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ApiError, ok, readJson } from "./api";
import { appMode } from "./app-mode";
import { censor } from "./censor";
import {
  importanceSchema,
  priorityFor,
  REACTIONS,
  settingsSchema,
  spamKey,
} from "./chat-rules";
import { isSchoolEmail } from "./school";
import { readImage } from "./uploads";
import {
  localDirectory,
  withLocalStore,
  type LocalChat,
  type LocalState,
  type LocalSticker,
} from "./local-store";
import type { HomeChat, Message, Person, Profile, Role } from "./types";

const scrypt = promisify(scryptCallback);
const COOKIE = "wicky_local_session";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
const uuid = z.uuid();
const accountSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
  name: z.string().trim().min(1).max(80).optional(),
});
const roleSchema = z.enum(["student", "teacher", "moderator", "admin"]);
const loginAttempts = new Map<string, { count: number; until: number }>();

function publicPerson(profile: Profile): Person {
  const { id, email, name, avatar_url, role } = profile;
  return { id, email, name, avatar_url, role };
}
function mod(me: Profile) {
  return me.role === "admin" || me.role === "moderator";
}
function needRole(me: Profile, ...roles: Role[]) {
  if (!roles.includes(me.role))
    throw new ApiError(
      403,
      "forbidden",
      "You do not have permission to do that.",
    );
}
function person(state: LocalState, id: string) {
  const profile = state.accounts.find(
    (account) => account.profile.id === id,
  )?.profile;
  if (!profile)
    throw new ApiError(404, "user_not_found", "That account does not exist.");
  return profile;
}
function currentUser(state: LocalState, req: Request) {
  const token = req.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)wicky_local_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const session =
    token &&
    state.sessions.find(
      (item) => item.hash === hash(token) && item.expires_at > Date.now(),
    );
  if (!session)
    throw new ApiError(401, "not_signed_in", "Sign in to use your chats.");
  return person(state, session.user_id);
}
function getChat(
  state: LocalState,
  id: string,
  me: Profile,
  readForModeration = false,
) {
  const chat = state.chats.find((item) => item.id === id);
  if (
    !chat ||
    (!chat.members.some((member) => member.id === me.id) &&
      !(readForModeration && mod(me)))
  )
    throw new ApiError(404, "chat_not_found", "That chat is not available.");
  return chat;
}
function manageChat(chat: LocalChat, me: Profile) {
  if (
    !chat.members.some(
      (member) =>
        member.id === me.id &&
        ["owner", "manager"].includes(member.member_role),
    )
  )
    throw new ApiError(
      403,
      "forbidden",
      "Only the chat owner or a manager can do that.",
    );
}
function enforceMembers(state: LocalState, ids: string[]) {
  if (ids.length > 3 && !ids.some((id) => person(state, id).role === "teacher"))
    throw new ApiError(
      409,
      "chat_full",
      "Chats can have at most 3 people unless a teacher is included.",
    );
}
function assignOwner(state: LocalState, chat: LocalChat) {
  const teachers = chat.members.filter(
    (member) => person(state, member.id).role === "teacher",
  );
  const owner =
    teachers.find((member) => member.member_role === "owner") ||
    teachers[0] ||
    chat.members.find((member) => member.member_role === "owner") ||
    chat.members[0];
  chat.members.forEach((member) => {
    if (member.id === owner?.id) member.member_role = "owner";
    else if (
      member.member_role === "owner" ||
      person(state, member.id).role === "teacher"
    )
      member.member_role = "manager";
  });
}
function stickerView(sticker: LocalSticker) {
  return {
    ...sticker,
    url:
      sticker.status === "rejected"
        ? undefined
        : `/api/local/assets/${sticker.id}`,
  };
}
function hydrate(state: LocalState, message: Message) {
  const sticker = state.stickers.find(
    (item) => item.id === message.sticker_id && item.status === "approved",
  );
  return {
    ...message,
    reactions: message.reactions || [],
    sticker_url: sticker ? `/api/local/assets/${sticker.id}` : null,
  };
}
function createSession(state: LocalState, me: Profile) {
  const token = randomBytes(32).toString("hex");
  state.sessions = state.sessions.filter(
    (session) => session.expires_at > Date.now(),
  );
  state.sessions.push({
    hash: hash(token),
    user_id: me.id,
    expires_at: Date.now() + 7 * 86400000,
  });
  const response = ok(me);
  response.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
  return response;
}
function home(state: LocalState, me: Profile) {
  const chats: HomeChat[] = state.chats
    .filter((chat) => chat.members.some((member) => member.id === me.id))
    .map((chat) => {
      const membership = chat.members.find((member) => member.id === me.id)!;
      const visible = state.messages.filter(
        (message) =>
          message.chat_id === chat.id && message.status === "visible",
      );
      const unread = visible.filter(
        (message) =>
          message.id > membership.last_read_id && message.user_id !== me.id,
      );
      const last = visible.at(-1);
      return {
        chat_id: chat.id,
        name: chat.name,
        kind: chat.kind,
        my_role: membership.member_role,
        last_message_at: chat.last_message_at,
        unread_count: unread.length,
        last_message: last || null,
        member_ids: chat.members.map((member) => member.id),
        notification_priority: Math.max(
          0,
          ...state.notifications
            .filter(
              (item) =>
                item.chat_id === chat.id &&
                item.user_id === me.id &&
                !item.read_at,
            )
            .map((item) => item.priority),
        ),
      };
    })
    .sort(
      (a, b) =>
        (b.notification_priority || 0) - (a.notification_priority || 0) ||
        b.last_message_at.localeCompare(a.last_message_at),
    );
  const ids = new Set(chats.flatMap((chat) => chat.member_ids));
  return {
    me,
    chats,
    total_unread: chats.reduce((sum, chat) => sum + chat.unread_count, 0),
    people: state.accounts
      .filter((account) => ids.has(account.profile.id))
      .map((account) => publicPerson(account.profile)),
  };
}
function hideMessage(state: LocalState, message: Message) {
  message.status = "hidden";
  state.notifications
    .filter((item) => item.message_id === message.id)
    .forEach((item) => {
      item.body = "Message removed";
      item.read_at = now();
    });
}

function messageById(state: LocalState, id: number, me: Profile) {
  const message = state.messages.find((item) => item.id === id);
  if (!message || (message.status !== "visible" && !mod(me)))
    throw new ApiError(
      404,
      "message_not_found",
      "That message is not available.",
    );
  getChat(state, message.chat_id, me, true);
  return message;
}

// Host checks
export async function handleLocalApi(req: Request, parts: string[]) {
  const host = req.headers.get("host") || "";
  let hostname = "";
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {}
  if (
    appMode() !== "local" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(hostname)
  )
    throw new ApiError(
      404,
      "not_found",
      "Local mode is only available on this computer.",
    );
  const method = req.method;
  if (
    method !== "GET" &&
    req.headers.get("origin") &&
    new URL(req.headers.get("origin")!).host !== host
  )
    throw new ApiError(
      403,
      "origin_mismatch",
      "This request must come from the app.",
    );
  const route = parts.join("/");
  const query = new URL(req.url).searchParams;
  return withLocalStore(async (state) => {
    if (method === "POST" && ["auth/signup", "auth/login"].includes(route)) {
      const input = await readJson(req, accountSchema);
      if (!isSchoolEmail(input.email))
        throw new ApiError(
          400,
          "school_email",
          "Use your chadwickschool.org email address.",
        );
      const key = hash(input.email);
      const attempt = loginAttempts.get(key);
      if (attempt && attempt.until > Date.now() && attempt.count >= 10)
        throw new ApiError(
          429,
          "try_later",
          "Too many sign-in attempts. Try again in a minute.",
        );
      loginAttempts.set(key, {
        count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1,
        until:
          attempt && attempt.until > Date.now()
            ? attempt.until
            : Date.now() + 60000,
      });
      const found = state.accounts.find(
        (account) => account.profile.email === input.email,
      );
      if (route === "auth/signup") {
        if (!input.name)
          throw new ApiError(400, "name_required", "Enter your name.");
        if (found)
          throw new ApiError(
            409,
            "account_exists",
            "That account already exists. Sign in instead.",
          );
        const salt = randomBytes(16).toString("hex");
        const password_hash = (
          (await scrypt(input.password, salt, 64)) as Buffer
        ).toString("hex");
        const profile: Profile = {
          id: randomUUID(),
          name: input.name,
          email: input.email,
          avatar_url: null,
          role: state.accounts.length === 0 ? "admin" : "student",
          settings: {},
          created_at: now(),
        };
        state.accounts.push({ profile, salt, password_hash });
        loginAttempts.delete(key);
        return createSession(state, profile);
      }
      const computed = (await scrypt(
        input.password,
        found?.salt || "missing-account",
        64,
      )) as Buffer;
      if (
        !found ||
        !timingSafeEqual(computed, Buffer.from(found.password_hash, "hex"))
      )
        throw new ApiError(
          401,
          "bad_credentials",
          "Email or password is incorrect.",
        );
      loginAttempts.delete(key);
      return createSession(state, found.profile);
    }
    const me = currentUser(state, req);
    if (route === "auth/logout" && method === "POST") {
      const token = req.headers
        .get("cookie")
        ?.match(/wicky_local_session=([a-f0-9]{64})/)?.[1];
      state.sessions = state.sessions.filter(
        (session) => session.hash !== hash(token || ""),
      );
      const response = ok({ signed_out: true });
      response.cookies.set(COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      return response;
    }
    if (route === "home" && method === "GET") return ok(home(state, me));
    if (route === "me") {
      if (method === "GET") return ok(me);
      if (method === "PATCH") {
        const input = await readJson(
          req,
          z
            .object({
              name: z.string().trim().min(1).max(80).optional(),
              settings: settingsSchema.optional(),
            })
            .strict(),
        );
        if (input.name) me.name = input.name;
        if (input.settings) me.settings = { ...me.settings, ...input.settings };
        return ok(me);
      }
    }
    if (route === "users" && method === "GET") {
      const search = (query.get("q") || "").toLowerCase();
      return ok(
        state.accounts
          .map((account) => publicPerson(account.profile))
          .filter((profile) =>
            `${profile.name} ${profile.email}`.toLowerCase().includes(search),
          )
          .slice(0, 50),
      );
    }
    if (
      parts[0] === "admin" &&
      parts[1] === "users" &&
      parts[3] === "role" &&
      method === "PATCH"
    ) {
      needRole(me, "admin");
      const target = person(state, uuid.parse(parts[2]));
      const { role } = await readJson(req, z.object({ role: roleSchema }));
      if (
        target.role === "admin" &&
        role !== "admin" &&
        state.accounts.filter((account) => account.profile.role === "admin")
          .length <= 1
      )
        throw new ApiError(
          409,
          "last_admin",
          "Keep at least one administrator.",
        );
      if (target.role === "teacher" && role !== "teacher") {
        for (const chat of state.chats.filter((item) =>
          item.members.some((member) => member.id === target.id),
        )) {
          if (
            chat.members.length > 3 &&
            !chat.members.some(
              (member) =>
                member.id !== target.id &&
                person(state, member.id).role === "teacher",
            )
          )
            throw new ApiError(
              409,
              "chat_full",
              "Remove extra members from this teacher's chats before changing their role.",
            );
        }
      }
      target.role = role;
      state.chats
        .filter((chat) =>
          chat.members.some((member) => member.id === target.id),
        )
        .forEach((chat) => assignOwner(state, chat));
      return ok(publicPerson(target));
    }
    if (route === "chats" && method === "POST") {
      const input = await readJson(
        req,
        z.object({
          user_ids: z.array(uuid).max(50).default([]),
          name: z.string().trim().max(80).optional(),
        }),
      );
      const ids = [...new Set([me.id, ...input.user_ids])];
      ids.forEach((id) => person(state, id));
      enforceMembers(state, ids);
      const kind =
        ids.length === 1
          ? "self"
          : ids.length === 2 && !input.name
            ? "dm"
            : "group";
      const existing = state.chats.find(
        (chat) =>
          chat.kind === kind &&
          kind !== "group" &&
          chat.members.length === ids.length &&
          chat.members.every((member) => ids.includes(member.id)),
      );
      if (existing) return ok(existing);
      const chat: LocalChat = {
        id: randomUUID(),
        name: input.name || null,
        kind,
        created_by: me.id,
        created_at: now(),
        last_message_at: now(),
        members: ids.map((id) => ({
          id,
          member_role: id === me.id ? "owner" : "member",
          last_read_id: 0,
        })),
      };
      assignOwner(state, chat);
      state.chats.push(chat);
      return ok(chat, 201);
    }
    if (parts[0] === "chats" && parts[1]) {
      const chat = getChat(state, parts[1], me);
      if (parts.length === 2 && method === "GET")
        return ok({
          ...chat,
          my_role: chat.members.find((member) => member.id === me.id)!
            .member_role,
          members: chat.members.map((member) => ({
            ...publicPerson(person(state, member.id)),
            member_role: member.member_role,
            last_read_at:
              state.messages.find(
                (message) => message.id === member.last_read_id,
              )?.created_at || chat.created_at,
          })),
        });
      if (parts.length === 2 && method === "PATCH") {
        manageChat(chat, me);
        const { name } = await readJson(
          req,
          z.object({ name: z.string().trim().max(80).nullable() }),
        );
        chat.name = name || null;
        return ok(chat);
      }
      if (parts[2] === "members" && method === "POST") {
        manageChat(chat, me);
        if (chat.kind === "self")
          throw new ApiError(
            400,
            "self_chat",
            "Notes to yourself stay private. Create a separate chat for other people.",
          );
        const { user_id } = await readJson(req, z.object({ user_id: uuid }));
        person(state, user_id);
        if (!chat.members.some((member) => member.id === user_id)) {
          enforceMembers(state, [
            ...chat.members.map((member) => member.id),
            user_id,
          ]);
          chat.members.push({
            id: user_id,
            member_role: "member",
            last_read_id: state.messages.at(-1)?.id || 0,
          });
          chat.kind = "group";
          assignOwner(state, chat);
        }
        return ok({ added: user_id });
      }
      if (parts[2] === "members" && parts[3] && method === "DELETE") {
        const target = person(state, parts[3]);
        if (!chat.members.some((member) => member.id === target.id))
          throw new ApiError(
            404,
            "member_not_found",
            "That person is not in the chat.",
          );
        if (target.id !== me.id) {
          manageChat(chat, me);
          if (target.role === "teacher" && me.role !== "teacher")
            throw new ApiError(
              403,
              "teacher_locked",
              "Students cannot remove a teacher.",
            );
          if (
            chat.members.find((member) => member.id === target.id)
              ?.member_role === "owner"
          )
            throw new ApiError(
              403,
              "owner_locked",
              "The chat owner must leave themselves.",
            );
        }
        const remaining = chat.members.filter(
          (member) => member.id !== target.id,
        );
        enforceMembers(
          state,
          remaining.map((member) => member.id),
        );
        chat.members = remaining;
        state.notifications = state.notifications.filter(
          (item) => item.chat_id !== chat.id || item.user_id !== target.id,
        );
        assignOwner(state, chat);
        return ok({ removed: target.id });
      }
      if (parts[2] === "read" && method === "POST") {
        const { last_message_id } = await readJson(
          req,
          z.object({ last_message_id: z.number().int().nonnegative() }),
        );
        const maximum = Math.max(
          0,
          ...state.messages
            .filter((message) => message.chat_id === chat.id)
            .map((message) => message.id),
        );
        const membership = chat.members.find((member) => member.id === me.id)!;
        membership.last_read_id = Math.max(
          membership.last_read_id,
          Math.min(maximum, last_message_id),
        );
        state.notifications
          .filter(
            (item) =>
              item.chat_id === chat.id &&
              item.user_id === me.id &&
              item.message_id <= membership.last_read_id,
          )
          .forEach((item) => {
            item.read_at = now();
          });
        return ok({ last_read_at: now() });
      }
      if (parts[2] === "messages") {
        if (method === "GET") {
          const before = Number(query.get("before")) || Infinity;
          const limit = Math.max(
            1,
            Math.min(100, Number(query.get("limit")) || 50),
          );
          const matches = state.messages.filter(
            (message) =>
              message.chat_id === chat.id &&
              message.id < before &&
              message.body
                .toLowerCase()
                .includes((query.get("q") || "").toLowerCase()) &&
              (message.status === "visible" || mod(me)),
          );
          return ok({
            messages: matches
              .slice(-limit)
              .map((message) => hydrate(state, message)),
            has_more: matches.length > limit,
          });
        }
        if (method === "POST") {
          const input = await readJson(
            req,
            z
              .object({
                body: z.string().trim().min(1).max(4000).optional(),
                sticker_id: uuid.optional(),
                ai_generated: z.boolean().default(false),
                importance: importanceSchema.default("unimportant"),
              })
              .refine(
                (value) => Boolean(value.body) !== Boolean(value.sticker_id),
                "Send text or a sticker.",
              ),
          );
          if (
            input.sticker_id &&
            !state.stickers.some(
              (sticker) =>
                sticker.id === input.sticker_id &&
                sticker.status === "approved",
            )
          )
            throw new ApiError(
              404,
              "sticker_not_found",
              "This sticker has not been approved yet.",
            );
          const cleaned = censor(input.body || "");
          const kind = input.sticker_id ? "sticker" : "text";
          const key = `${kind}:${input.sticker_id || spamKey(cleaned.text)}`;
          const recent = state.messages
            .filter((message) => message.chat_id === chat.id)
            .slice(-2);
          if (
            recent.length === 2 &&
            recent.every(
              (message) =>
                message.user_id === me.id &&
                `${message.kind}:${message.sticker_id || spamKey(message.body)}` ===
                  key,
            )
          )
            throw new ApiError(
              429,
              "spam",
              "You already sent that twice in a row. Wait for a reply or send something different.",
            );
          const message: Message = {
            id: state.next_message_id++,
            chat_id: chat.id,
            user_id: me.id,
            kind,
            body: cleaned.text,
            sticker_id: input.sticker_id || null,
            image_path: null,
            is_ai: false,
            ai_tag: input.ai_generated ? "self_tagged" : null,
            importance: input.importance,
            status: "visible",
            reactions: [],
            created_at: now(),
          };
          state.messages.push(message);
          chat.last_message_at = message.created_at;
          chat.members.find((member) => member.id === me.id)!.last_read_id =
            message.id;
          chat.members
            .filter((member) => member.id !== me.id)
            .forEach((member) =>
              state.notifications.push({
                id: randomUUID(),
                user_id: member.id,
                chat_id: chat.id,
                message_id: message.id,
                sender_name: me.name,
                body: cleaned.text || "Sent a sticker",
                priority: priorityFor(me.role, input.importance),
                is_teacher: me.role === "teacher",
                created_at: message.created_at,
                read_at: null,
              }),
            );
          return ok(
            {
              message: hydrate(state, message),
              moderation: { censored: cleaned.censored, checked: false },
            },
            201,
          );
        }
      }
    }
    if (parts[0] === "messages" && parts[1]) {
      const message = messageById(state, Number(parts[1]), me);
      if (parts[2] === "reactions" && method === "POST") {
        getChat(state, message.chat_id, me);
        const { emoji } = await readJson(
          req,
          z.object({ emoji: z.enum(REACTIONS) }),
        );
        const prior = message.reactions?.find(
          (reaction) => reaction.user_id === me.id,
        );
        message.reactions = (message.reactions || []).filter(
          (reaction) => reaction.user_id !== me.id,
        );
        if (prior?.emoji !== emoji)
          message.reactions.push({ user_id: me.id, emoji });
        return ok(message.reactions);
      }
      if (parts.length === 2 && method === "DELETE") {
        if (message.user_id !== me.id && !mod(me))
          throw new ApiError(
            403,
            "forbidden",
            "Only the sender or a moderator can remove this message.",
          );
        hideMessage(state, message);
        return ok({ deleted: message.id });
      }
      if (parts.length === 2 && method === "GET")
        return ok(hydrate(state, message));
    }
    if (route === "notifications") {
      if (method === "GET")
        return ok(
          state.notifications
            .filter(
              (item) =>
                item.user_id === me.id &&
                state.chats.some(
                  (chat) =>
                    chat.id === item.chat_id &&
                    chat.members.some((member) => member.id === me.id),
                ),
            )
            .sort(
              (a, b) =>
                Number(Boolean(a.read_at)) - Number(Boolean(b.read_at)) ||
                b.priority - a.priority ||
                b.created_at.localeCompare(a.created_at),
            )
            .slice(0, 100),
        );
      if (method === "PATCH") {
        const { id } = await readJson(req, z.object({ id: uuid.optional() }));
        state.notifications
          .filter((item) => item.user_id === me.id && (!id || item.id === id))
          .forEach((item) => {
            item.read_at = now();
          });
        return ok({ updated: true });
      }
    }
    if (route === "reports") {
      if (method === "GET")
        return ok(
          state.reports.filter((report) => report.reporter_id === me.id),
        );
      if (method === "POST") {
        const input = await readJson(
          req,
          z
            .object({
              message_id: z.number().int().positive().optional(),
              user_id: uuid.optional(),
              reason: z.string().trim().min(1).max(1000),
            })
            .refine(
              (value) => Boolean(value.message_id) !== Boolean(value.user_id),
              "Choose a message or a user.",
            ),
        );
        const target = input.message_id
          ? messageById(state, input.message_id, me)
          : null;
        if (input.user_id) person(state, input.user_id);
        if (input.user_id === me.id)
          throw new ApiError(400, "self_report", "You cannot report yourself.");
        const report = {
          id: state.next_report_id++,
          reporter_id: me.id,
          target_type: target ? ("message" as const) : ("user" as const),
          message_id: target?.id || null,
          user_id: target?.user_id || input.user_id || null,
          reason: input.reason,
          status: "open" as const,
          resolved_by: null,
          resolved_at: null,
          created_at: now(),
        };
        state.reports.push(report);
        return ok(report, 201);
      }
    }
    if (route === "stickers") {
      if (method === "GET")
        return ok(
          state.stickers
            .filter((sticker) =>
              query.get("mine") === "1"
                ? sticker.owner_id === me.id
                : sticker.status === "approved",
            )
            .map(stickerView),
        );
      if (method === "POST") {
        const { bytes, type, form } = await readImage(req, 2 * 1024 * 1024);
        const name = z.string().trim().min(1).max(40).parse(form.get("name"));
        if (
          form.get("original") !== "true" ||
          form.get("ai_generated") === "true"
        )
          throw new ApiError(
            422,
            "original_required",
            "Only human-made stickers and GIFs are accepted.",
          );
        const id = randomUUID();
        const directory = path.join(localDirectory(), "assets");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(path.join(directory, id), bytes, { mode: 0o600 });
        const sticker: LocalSticker = {
          id,
          owner_id: me.id,
          name,
          path: id,
          is_gif: type === "image/gif",
          mime_type: type,
          is_official: form.get("official") === "true" && me.role === "admin",
          status: "pending",
          reject_reason: null,
          created_at: now(),
        };
        state.stickers.push(sticker);
        return ok(stickerView(sticker), 201);
      }
    }
    if (parts[0] === "assets" && method === "GET") {
      const sticker = state.stickers.find((item) => item.id === parts[1]);
      if (
        !sticker ||
        sticker.status === "rejected" ||
        (sticker.status !== "approved" &&
          sticker.owner_id !== me.id &&
          !mod(me))
      )
        throw new ApiError(404, "not_found", "This file is not available.");
      const bytes = await readFile(
        path.join(localDirectory(), "assets", sticker.id),
      );
      return new Response(bytes, {
        headers: {
          "Content-Type": sticker.mime_type,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (parts[0] === "mod") {
      needRole(me, "moderator", "admin");
      if (parts[1] === "reports") {
        if (method === "GET")
          return ok(
            state.reports
              .filter(
                (report) => report.status === (query.get("status") || "open"),
              )
              .map((report) => ({
                ...report,
                reporter: publicPerson(person(state, report.reporter_id)),
                target: report.user_id
                  ? publicPerson(person(state, report.user_id))
                  : null,
                message:
                  state.messages.find(
                    (message) => message.id === report.message_id,
                  ) || null,
              })),
          );
        if (method === "PATCH") {
          const report = state.reports.find(
            (item) => item.id === Number(parts[2]),
          );
          if (!report)
            throw new ApiError(404, "not_found", "Report not found.");
          const input = await readJson(
            req,
            z.object({
              status: z.enum(["resolved", "dismissed", "open"]),
              hide_message: z.boolean().optional(),
            }),
          );
          if (input.hide_message && report.message_id)
            state.messages
              .filter((message) => message.id === report.message_id)
              .forEach((message) => hideMessage(state, message));
          report.status = input.status;
          report.resolved_by = input.status === "open" ? null : me.id;
          report.resolved_at = input.status === "open" ? null : now();
          return ok(report);
        }
      }
      if (parts[1] === "stickers") {
        if (method === "GET")
          return ok(
            state.stickers
              .filter(
                (sticker) =>
                  sticker.status === (query.get("status") || "pending"),
              )
              .map(stickerView),
          );
        if (method === "PATCH") {
          const sticker = state.stickers.find((item) => item.id === parts[2]);
          if (!sticker)
            throw new ApiError(404, "not_found", "Sticker not found.");
          const input = await readJson(
            req,
            z.object({
              status: z.enum(["approved", "rejected"]),
              reason: z.string().trim().max(300).optional(),
              official: z.boolean().optional(),
            }),
          );
          sticker.status = input.status;
          sticker.reject_reason =
            input.status === "rejected"
              ? input.reason || "Rejected by a moderator"
              : null;
          if (me.role === "admin" && input.official !== undefined)
            sticker.is_official = input.official;
          return ok(stickerView(sticker));
        }
      }
    }
    if (parts[0] === "wiki") {
      if (method === "GET") {
        if (!parts[1])
          return ok(
            state.wiki.map(({ slug, title, updated_at }) => ({
              slug,
              title,
              updated_at,
            })),
          );
        const page = state.wiki.find((item) => item.slug === parts[1]);
        if (!page)
          throw new ApiError(
            404,
            "page_not_found",
            "This page does not exist yet.",
          );
        return ok(page);
      }
      if (method === "PUT" && parts[1]) {
        needRole(me, "teacher", "moderator", "admin");
        const slug = z
          .string()
          .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
          .max(100)
          .parse(parts[1]);
        const input = await readJson(
          req,
          z.object({
            title: z.string().trim().min(1).max(120),
            body: z.string().max(50000),
          }),
        );
        const page = { slug, ...input, updated_at: now(), updated_by: me.id };
        state.wiki = [...state.wiki.filter((item) => item.slug !== slug), page];
        return ok(page);
      }
    }
    if (route === "wickypedia" && method === "POST")
      throw new ApiError(
        503,
        "ai_off",
        "AI is not configured. You can still read and edit school wiki pages.",
      );
    throw new ApiError(404, "not_found", "This action is not available.");
  }, method !== "GET");
}
