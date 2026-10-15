import { z } from "zod";
import { ok, readJson, route, check } from "@/lib/api";
import { requireMember, requireUser } from "@/lib/auth";

export const PATCH = route(
  async (
    request: Request,
    context: RouteContext<"/api/chats/[id]/members/[userId]">,
  ) => {
    const { me, admin } = await requireUser();
    const { id, userId } = await context.params;
    await requireMember(id, me, "owner", "manager");
    const { member_role } = await readJson(
      request,
      z.object({ member_role: z.enum(["owner", "manager", "member"]) }),
    );
    check(
      await admin.rpc("set_chat_member_role", {
        actor: me.id,
        c: id,
        target: userId,
        requested: member_role,
      }),
    );
    return ok({ user_id: userId, member_role });
  },
);

export const DELETE = route(
  async (
    _request: Request,
    context: RouteContext<"/api/chats/[id]/members/[userId]">,
  ) => {
    const { me, admin } = await requireUser();
    const { id, userId } = await context.params;
    await requireMember(id, me);
    check(
      await admin.rpc("remove_chat_member", {
        actor: me.id,
        c: id,
        target: userId,
      }),
    );
    return ok({ removed: userId });
  },
);
