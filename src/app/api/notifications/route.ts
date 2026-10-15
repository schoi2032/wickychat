import { z } from "zod";
import { ok, route, readJson, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const GET = route(async () => {
  const { me, admin } = await requireUser();
  const memberships = check(
    await admin.from("chat_members").select("chat_id").eq("user_id", me.id),
  );
  if (!memberships.length) return ok([]);
  return ok(
    check(
      await admin
        .from("notifications")
        .select("*")
        .eq("user_id", me.id)
        .in(
          "chat_id",
          memberships.map((row) => row.chat_id),
        )
        .order("read_at", { ascending: true, nullsFirst: true })
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100),
    ),
  );
});
export const PATCH = route(async (request: Request) => {
  const { me, admin } = await requireUser();
  const { id } = await readJson(request, z.object({ id: z.uuid().optional() }));
  let update = admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", me.id);
  if (id) update = update.eq("id", id);
  check(await update);
  return ok({ updated: true });
});
