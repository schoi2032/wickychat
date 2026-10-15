import { z } from "zod";
import { ok, route, check, readJson, ApiError } from "@/lib/api";
import { requireMember, requireUser } from "@/lib/auth";

export const POST = route(
  async (request: Request, ctx: RouteContext<"/api/chats/[id]/read">) => {
    const { me, admin } = await requireUser();
    const { id } = await ctx.params;
    await requireMember(id, me);
    const { last_message_id } = await readJson(
      request,
      z.object({ last_message_id: z.number().int().nonnegative() }),
    );
    if (!last_message_id) return ok({ updated: false });
    const message = check(
      await admin
        .from("messages")
        .select("created_at")
        .eq("chat_id", id)
        .eq("id", last_message_id)
        .maybeSingle(),
    );
    if (!message)
      throw new ApiError(
        400,
        "bad_message",
        "That message is not in this chat.",
      );
    check(
      await admin
        .from("chat_members")
        .update({ last_read_at: message.created_at })
        .eq("chat_id", id)
        .eq("user_id", me.id)
        .lt("last_read_at", message.created_at),
    );
    check(
      await admin
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("chat_id", id)
        .eq("user_id", me.id)
        .lte("message_id", last_message_id),
    );
    return ok({ last_read_at: message.created_at });
  },
);
