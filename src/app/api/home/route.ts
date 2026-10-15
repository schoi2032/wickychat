import { ok, route, check } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import type { HomeChat, Person } from "@/lib/types";

export const GET = route(async () => {
  const { me, supabase, admin } = await requireUser();
  const chats = check(await supabase.rpc("home_feed")) as HomeChat[];
  const ids = [...new Set(chats.flatMap((c) => c.member_ids ?? []))];
  const people = ids.length
    ? (check(
        await admin
          .from("profiles")
          .select("id, email, name, avatar_url, role")
          .in("id", ids),
      ) as Person[])
    : [];
  const notifications = chats.length
    ? check(
        await admin
          .from("notifications")
          .select("chat_id, priority")
          .eq("user_id", me.id)
          .is("read_at", null)
          .in(
            "chat_id",
            chats.map((chat) => chat.chat_id),
          ),
      )
    : [];
  for (const chat of chats)
    chat.notification_priority = Math.max(
      0,
      ...notifications
        .filter((item) => item.chat_id === chat.chat_id)
        .map((item) => item.priority),
    );
  chats.sort(
    (a, b) =>
      (b.notification_priority || 0) - (a.notification_priority || 0) ||
      b.last_message_at.localeCompare(a.last_message_at),
  );
  const total_unread = chats.reduce(
    (sum, c) => sum + Number(c.unread_count),
    0,
  );
  return ok({ me, total_unread, chats, people });
});
