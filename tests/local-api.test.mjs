import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const base = "http://127.0.0.1:3101";
let directory,
  server,
  logs = "",
  notes,
  group,
  teacher;
const users = {};
function client() {
  let cookie = "";
  return {
    async request(
      route,
      { method = "GET", body, status = 200, headers = {} } = {},
    ) {
      const response = await fetch(`${base}/api/local${route}`, {
        method,
        headers: {
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          cookie,
          Origin: base,
          ...headers,
        },
        body:
          body instanceof FormData
            ? body
            : body === undefined
              ? undefined
              : JSON.stringify(body),
      });
      const data = await response.json();
      assert.equal(
        response.status,
        status,
        `${method} ${route}: ${JSON.stringify(data)}`,
      );
      if (response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      return data.data;
    },
    get cookie() {
      return cookie;
    },
  };
}
async function signup(key, role) {
  const account = client();
  const profile = await account.request("/auth/signup", {
    method: "POST",
    body: {
      name: key,
      email: `${key}@chadwickschool.org`,
      password: "test-password-123",
    },
  });
  assert.equal(profile.role, role);
  assert.equal(profile.password_hash, undefined);
  users[key] = { ...account, profile };
  return users[key];
}

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "wicky-api-test-"));
  const env = {
    ...process.env,
    WICKY_LOCAL_MODE: "1",
    WICKY_LOCAL_DATA_DIR: directory,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  delete env.NEXT_PUBLIC_SUPABASE_URL;
  delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3101",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  server.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Test server did not start: ${logs}`);
});
after(async () => {
  server?.kill("SIGTERM");
  if (server && server.exitCode === null)
    await new Promise((resolve) => server.once("exit", resolve));
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("accounts are authenticated, school-only, and start with no chats", async () => {
  const anonymous = client();
  await anonymous.request("/home", { status: 401 });
  await anonymous.request("/auth/signup", {
    method: "POST",
    status: 400,
    body: {
      name: "Outside",
      email: "outside@example.com",
      password: "test-password-123",
    },
  });
  for (const [index, key] of [
    "admin",
    "alex",
    "blair",
    "casey",
    "drew",
    "educator",
  ].entries()) {
    const user = await signup(key, index === 0 ? "admin" : "student");
    const home = await user.request("/home");
    assert.deepEqual(home.chats, []);
    assert.equal(home.total_unread, 0);
  }
  await anonymous.request("/auth/login", {
    method: "POST",
    status: 401,
    body: { email: "alex@chadwickschool.org", password: "wrong-password-123" },
  });
  await users.alex.request(`/admin/users/${users.alex.profile.id}/role`, {
    method: "PATCH",
    status: 403,
    body: { role: "teacher" },
  });
  await users.admin.request(`/admin/users/${users.admin.profile.id}/role`, {
    method: "PATCH",
    status: 409,
    body: { role: "student" },
  });
});

test("notes are only created by the user and stay private", async () => {
  notes = await users.alex.request("/chats", {
    method: "POST",
    status: 201,
    body: { user_ids: [], name: "My ideas" },
  });
  assert.equal(notes.kind, "self");
  const again = await users.alex.request("/chats", {
    method: "POST",
    body: { user_ids: [] },
  });
  assert.equal(again.id, notes.id);
  await users.blair.request(`/chats/${notes.id}/messages`, { status: 404 });
  await users.alex.request(`/chats/${notes.id}/members`, {
    method: "POST",
    status: 400,
    body: { user_id: users.blair.profile.id },
  });
});

test("messages save, censor swears, preserve importance and explicit AI tags", async () => {
  const sent = await users.alex.request(`/chats/${notes.id}/messages`, {
    method: "POST",
    status: 201,
    body: {
      body: "This shit is hard",
      importance: "important",
      ai_generated: true,
    },
  });
  assert.equal(sent.message.body, "This **** is hard");
  assert.equal(sent.message.importance, "important");
  assert.equal(sent.message.ai_tag, "self_tagged");
  assert.equal(sent.moderation.checked, false);
  const loaded = await users.alex.request(`/chats/${notes.id}/messages`);
  assert.equal(loaded.messages[0].id, sent.message.id);
  const stored = JSON.parse(
    await readFile(path.join(directory, "store.json"), "utf8"),
  );
  assert.equal(stored.messages[0].body, "This **** is hard");
  assert(!JSON.stringify(stored).includes('"password":"test-password-123"'));
});

test("third identical message is blocked, including simultaneous requests", async () => {
  const results = await Promise.all(
    [201, 201, 429].map(async () => {
      const response = await fetch(
        `${base}/api/local/chats/${notes.id}/messages`,
        {
          method: "POST",
          headers: {
            cookie: users.alex.cookie,
            "Content-Type": "application/json",
            Origin: base,
          },
          body: JSON.stringify({ body: "same message" }),
        },
      );
      return response.status;
    }),
  );
  assert.deepEqual(results.sort(), [201, 201, 429]);
  const loaded = await users.alex.request(`/chats/${notes.id}/messages`);
  assert.equal(
    loaded.messages.filter((message) => message.body === "same message").length,
    2,
  );
});

test("student-only chats stop at three and teachers become owners", async () => {
  group = await users.alex.request("/chats", {
    method: "POST",
    status: 201,
    body: {
      name: "A real chat",
      user_ids: [users.blair.profile.id, users.casey.profile.id],
    },
  });
  await users.alex.request(`/chats/${group.id}/members`, {
    method: "POST",
    status: 409,
    body: { user_id: users.drew.profile.id },
  });
  await users.admin.request(`/admin/users/${users.educator.profile.id}/role`, {
    method: "PATCH",
    body: { role: "teacher" },
  });
  await users.alex.request(`/chats/${group.id}/members`, {
    method: "POST",
    body: { user_id: users.educator.profile.id },
  });
  teacher = users.educator;
  let detail = await teacher.request(`/chats/${group.id}`);
  assert.equal(
    detail.members.find((member) => member.id === teacher.profile.id)
      .member_role,
    "owner",
  );
  assert.equal(
    detail.members.find((member) => member.id === users.alex.profile.id)
      .member_role,
    "manager",
  );
  await teacher.request(`/chats/${group.id}/members`, {
    method: "POST",
    body: { user_id: users.drew.profile.id },
  });
  await teacher.request(`/chats/${group.id}/members/${teacher.profile.id}`, {
    method: "DELETE",
    status: 409,
  });
  await users.alex.request(`/chats/${group.id}/members/${teacher.profile.id}`, {
    method: "DELETE",
    status: 403,
  });
  await users.admin.request(`/admin/users/${teacher.profile.id}/role`, {
    method: "PATCH",
    status: 409,
    body: { role: "student" },
  });
  detail = await teacher.request(`/chats/${group.id}`);
  assert.equal(detail.members.length, 5);
});

test("teacher notifications outrank important student messages, with unread counts", async () => {
  await users.blair.request(`/chats/${group.id}/messages`, {
    method: "POST",
    status: 201,
    body: { body: "Student announcement", importance: "important" },
  });
  const posted = await teacher.request(`/chats/${group.id}/messages`, {
    method: "POST",
    status: 201,
    body: { body: "Teacher announcement", importance: "unimportant" },
  });
  const items = await users.alex.request("/notifications");
  assert.equal(items[0].is_teacher, true);
  assert(items[0].priority > items.find((item) => !item.is_teacher).priority);
  const home = await users.alex.request("/home");
  assert.equal(
    home.chats.find((chat) => chat.chat_id === group.id).unread_count,
    2,
  );
  await users.alex.request(`/chats/${group.id}/read`, {
    method: "POST",
    body: { last_message_id: posted.message.id },
  });
  assert.equal(
    (await users.alex.request("/home")).chats.find(
      (chat) => chat.chat_id === group.id,
    ).unread_count,
    0,
  );
  assert(
    (await users.alex.request("/notifications")).every((item) => item.read_at),
  );
});

test("reactions are limited to the allowed emoji and one per person", async () => {
  const { messages } = await users.alex.request(`/chats/${group.id}/messages`);
  const message = messages[0];
  await users.alex.request(`/messages/${message.id}/reactions`, {
    method: "POST",
    status: 400,
    body: { emoji: "🔥" },
  });
  await users.alex.request(`/messages/${message.id}/reactions`, {
    method: "POST",
    body: { emoji: "👍" },
  });
  let reactions = await users.alex.request(
    `/messages/${message.id}/reactions`,
    { method: "POST", body: { emoji: "✅" } },
  );
  assert.deepEqual(reactions, [
    { user_id: users.alex.profile.id, emoji: "✅" },
  ]);
  reactions = await users.alex.request(`/messages/${message.id}/reactions`, {
    method: "POST",
    body: { emoji: "✅" },
  });
  assert.deepEqual(reactions, []);
});

test("reporting and moderation hide messages from students", async () => {
  const { messages } = await users.alex.request(`/chats/${group.id}/messages`);
  const report = await users.alex.request("/reports", {
    method: "POST",
    status: 201,
    body: { message_id: messages[0].id, reason: "Please review this" },
  });
  await users.alex.request("/mod/reports", { status: 403 });
  assert(
    (await users.admin.request("/mod/reports")).some(
      (item) => item.id === report.id,
    ),
  );
  await users.admin.request(`/mod/reports/${report.id}`, {
    method: "PATCH",
    body: { status: "resolved", hide_message: true },
  });
  assert(
    !(await users.alex.request(`/chats/${group.id}/messages`)).messages.some(
      (message) => message.id === messages[0].id,
    ),
  );
  const removedNotification = (await users.alex.request("/notifications")).find(
    (item) => item.message_id === messages[0].id,
  );
  assert.equal(removedNotification.body, "Message removed");
  assert(removedNotification.read_at);
  const userReport = await users.alex.request("/reports", {
    method: "POST",
    status: 201,
    body: { user_id: users.blair.profile.id, reason: "User report" },
  });
  assert.equal(userReport.target_type, "user");
});

test("stickers require valid files, human-made attestation, and moderator approval", async () => {
  const gif = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64",
  );
  const form = () => {
    const body = new FormData();
    body.set("name", "My WICKY GIF");
    body.set("file", new Blob([gif], { type: "image/gif" }), "wicky.gif");
    return body;
  };
  const noAttestation = form();
  await users.alex.request("/stickers", {
    method: "POST",
    status: 422,
    body: noAttestation,
  });
  const body = form();
  body.set("original", "true");
  const sticker = await users.alex.request("/stickers", {
    method: "POST",
    status: 201,
    body,
  });
  assert.equal(sticker.status, "pending");
  assert(
    !(await users.alex.request("/stickers")).some(
      (item) => item.id === sticker.id,
    ),
  );
  await users.alex.request(`/chats/${notes.id}/messages`, {
    method: "POST",
    status: 404,
    body: { sticker_id: sticker.id },
  });
  await users.alex.request(`/mod/stickers/${sticker.id}`, {
    method: "PATCH",
    status: 403,
    body: { status: "approved" },
  });
  await users.admin.request(`/mod/stickers/${sticker.id}`, {
    method: "PATCH",
    body: { status: "approved" },
  });
  const sent = await users.alex.request(`/chats/${notes.id}/messages`, {
    method: "POST",
    status: 201,
    body: { sticker_id: sticker.id },
  });
  assert(sent.message.sticker_url.includes(sticker.id));
  const file = await fetch(`${base}${sent.message.sticker_url}`, {
    headers: { cookie: users.alex.cookie },
  });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/gif");
  const invalid = new FormData();
  invalid.set("name", "fake");
  invalid.set("original", "true");
  invalid.set(
    "file",
    new Blob(["not an image"], { type: "image/png" }),
    "fake.png",
  );
  await users.alex.request("/stickers", {
    method: "POST",
    status: 415,
    body: invalid,
  });
});

test("settings and wiki editing persist, and unavailable AI is explicit", async () => {
  await users.alex.request("/me", {
    method: "PATCH",
    body: { settings: { theme: "dark", accent: "#2456ab", compact: true } },
  });
  assert.equal((await users.alex.request("/me")).settings.theme, "dark");
  await users.alex.request("/wiki/resources", {
    method: "PUT",
    status: 403,
    body: { title: "Resources", body: "School resources" },
  });
  await teacher.request("/wiki/resources", {
    method: "PUT",
    body: { title: "Resources", body: "School resources" },
  });
  assert.equal(
    (await users.alex.request("/wiki/resources")).body,
    "School resources",
  );
  await users.alex.request("/wickypedia", {
    method: "POST",
    status: 503,
    body: { question: "What is WICKY?" },
  });
});

test("search filters messages and paginates without exposing other chats", async () => {
  const results = await users.alex.request(
    `/chats/${notes.id}/messages?q=same&limit=1`,
  );
  assert.equal(results.messages.length, 1);
  assert.equal(results.has_more, true);
  assert.equal(results.messages[0].body, "same message");
  const older = await users.alex.request(
    `/chats/${notes.id}/messages?q=same&before=${results.messages[0].id}`,
  );
  assert.equal(older.messages.length, 1);
  await users.blair.request(`/messages/${results.messages[0].id}/reactions`, {
    method: "POST",
    status: 404,
    body: { emoji: "👍" },
  });
});

test("removed members lose chat and notification access", async () => {
  assert((await users.drew.request("/notifications")).length > 0);
  await teacher.request(`/chats/${group.id}/members/${users.drew.profile.id}`, {
    method: "DELETE",
  });
  await users.drew.request(`/chats/${group.id}/messages`, { status: 404 });
  assert.deepEqual(await users.drew.request("/notifications"), []);
});

test("cross-origin mutations are rejected and logout invalidates the session", async () => {
  await users.alex.request("/me", {
    method: "PATCH",
    status: 403,
    headers: { Origin: "https://example.com" },
    body: { name: "Changed" },
  });
  await users.alex.request("/auth/logout", { method: "POST", body: {} });
  await users.alex.request("/home", { status: 401 });
});
