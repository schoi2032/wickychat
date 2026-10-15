import { z } from "zod";
import { ok, readJson, route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const PATCH = route(
  async (
    request: Request,
    context: RouteContext<"/api/admin/users/[id]/role">,
  ) => {
    const { me, admin } = await requireUser("admin");
    const { id } = await context.params;
    const { role } = await readJson(
      request,
      z.object({ role: z.enum(["student", "teacher", "moderator", "admin"]) }),
    );
    check(
      await admin.rpc("set_profile_role", {
        actor: me.id,
        target: id,
        requested: role,
      }),
    );
    return ok(
      check(
        await admin
          .from("profiles")
          .select("id, email, name, role")
          .eq("id", id)
          .single(),
      ),
    );
  },
);
