import { z } from "zod";
import { ok, route, readJson, check, ApiError } from "@/lib/api";
import { requireMember, requireUser } from "@/lib/auth";
import { REACTIONS } from "@/lib/chat-rules";

export const POST = route(
  async (
    request: Request,
    context: RouteContext<"/api/messages/[id]/reactions">,
  ) => {
    const { me, admin } = await requireUser();
    const { id } = await context.params;
    const messageId = Number(id);
    if (!Number.isSafeInteger(messageId) || messageId < 1)
      throw new ApiError(400, "bad_id", "Invalid message.");
    const { emoji } = await readJson(
      request,
      z.object({ emoji: z.enum(REACTIONS) }),
    );
    const message = check(
      await admin
        .from("messages")
        .select("chat_id, status")
        .eq("id", messageId)
        .maybeSingle(),
    );
    if (!message || message.status !== "visible")
      throw new ApiError(404, "message_not_found", "Message not available.");
    const member = await requireMember(message.chat_id, me);
    if (!member)
      throw new ApiError(403, "forbidden", "Only chat members can react.");
    check(
      await admin.rpc("toggle_reaction", {
        actor: me.id,
        message: messageId,
        reaction: emoji,
      }),
    );
    return ok(
      check(
        await admin
          .from("message_reactions")
          .select("user_id, emoji")
          .eq("message_id", messageId),
      ),
    );
  },
);
