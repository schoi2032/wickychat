-- Priority labels, notifications, limited reactions, and membership invariants.
-- This migration creates no chats, people, stickers, or messages.
alter table public.messages add column importance text not null default 'unimportant'
  check (importance in ('important', 'slightly_important', 'unimportant'));

create table public.message_reactions (
  message_id bigint not null references public.messages on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '✅', '❓')),
  primary key (message_id, user_id)
);
alter table public.message_reactions enable row level security;
create policy "members see reactions" on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.chat_id) and m.status = 'visible'));
revoke insert, update, delete on public.message_reactions from anon, authenticated;

create function public.toggle_reaction(actor uuid, message bigint, reaction text) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid; existing text;
begin
  if reaction not in ('👍', '❤️', '✅', '❓') then raise exception 'Invalid reaction'; end if;
  select chat_id into c from messages where id = message and status = 'visible' for update;
  if c is null or not exists (select 1 from chat_members where chat_id = c and user_id = actor) then raise exception 'Not a member'; end if;
  select emoji into existing from message_reactions where message_id = message and user_id = actor;
  if existing = reaction then
    delete from message_reactions where message_id = message and user_id = actor;
  else
    insert into message_reactions(message_id, user_id, emoji) values (message, actor, reaction)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji;
  end if;
end;
$$;
revoke execute on function public.toggle_reaction(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.toggle_reaction(uuid, bigint, text) to service_role;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  chat_id uuid not null references public.chats on delete cascade,
  message_id bigint not null references public.messages on delete cascade,
  sender_name text not null,
  body text not null,
  priority integer not null,
  is_teacher boolean not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);
create index notifications_user_idx on public.notifications(user_id, read_at, priority desc, created_at desc);
alter table public.notifications enable row level security;
create policy "read your notifications" on public.notifications for select to authenticated using (user_id = auth.uid() and public.is_member(chat_id));
revoke insert, update, delete on public.notifications from anon, authenticated;

create function public.notify_chat_members() returns trigger
language plpgsql security definer set search_path = public as $$
declare sender text; teacher boolean; weight integer;
begin
  select name, role = 'teacher' into sender, teacher from profiles where id = new.user_id;
  teacher := coalesce(teacher, false);
  weight := case when teacher then 100 else 0 end + case new.importance when 'important' then 40 when 'slightly_important' then 20 else 0 end;
  insert into notifications(user_id, chat_id, message_id, sender_name, body, priority, is_teacher, created_at)
    select m.user_id, new.chat_id, new.id, coalesce(sender, 'WICKYpedia'),
      left(case when new.body <> '' then new.body when new.kind = 'sticker' then 'Sent a sticker' else 'Sent an image' end, 300),
      weight, teacher, new.created_at
    from chat_members m where m.chat_id = new.chat_id and m.user_id is distinct from new.user_id;
  return new;
end;
$$;
create trigger after_message_notification after insert on public.messages for each row execute function public.notify_chat_members();

-- Serialize joins and sends within each chat so simultaneous requests obey the limits.
create or replace function public.member_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare joining_role text; member_count integer; has_teacher boolean;
begin
  perform 1 from chats where id = new.chat_id for update;
  if exists (select 1 from chat_members where chat_id = new.chat_id and user_id = new.user_id) then return new; end if;
  select role into joining_role from profiles where id = new.user_id;
  select count(*), coalesce(bool_or(p.role = 'teacher'), false) into member_count, has_teacher
    from chat_members m join profiles p on p.id = m.user_id where m.chat_id = new.chat_id;
  if member_count >= 3 and not has_teacher and joining_role <> 'teacher' then raise exception 'chat_full: A teacher is required for more than 3 members'; end if;
  if joining_role = 'teacher' then
    if has_teacher then new.member_role := 'manager';
    else
      update chat_members set member_role = 'manager' where chat_id = new.chat_id and member_role = 'owner';
      new.member_role := 'owner';
    end if;
  end if;
  return new;
end;
$$;
create or replace function public.block_spam() returns trigger
language plpgsql security definer set search_path = public as $$
declare repeats integer;
begin
  perform 1 from chats where id = new.chat_id for update;
  if new.user_id is null then return new; end if;
  select count(*) into repeats from (
    select m from messages m where m.chat_id = new.chat_id order by m.id desc limit 2
  ) recent where (recent.m).user_id = new.user_id and public.spam_key(recent.m) = public.spam_key(new);
  if repeats >= 2 then raise exception 'spam: You already sent that twice in a row'; end if;
  return new;
end;
$$;

create function public.check_chat_invariants(c uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n integer; teachers integer; owners integer; teacher_owns boolean;
begin
  perform 1 from chats where id = c for update;
  select count(*), count(*) filter (where p.role = 'teacher'),
    count(*) filter (where m.member_role = 'owner'),
    coalesce(bool_or(p.role = 'teacher' and m.member_role = 'owner'), false)
    into n, teachers, owners, teacher_owns
    from chat_members m join profiles p on p.id = m.user_id where m.chat_id = c;
  if n > 3 and teachers = 0 then raise exception 'chat_full: Keep a teacher in chats with more than 3 members'; end if;
  if n > 0 and owners <> 1 then raise exception 'owner_required: A chat needs exactly one owner'; end if;
  if teachers > 0 and not teacher_owns then raise exception 'teacher_owner: A teacher must own this chat'; end if;
end;
$$;
create function public.validate_chat_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.check_chat_invariants(coalesce(new.chat_id, old.chat_id));
  return null;
end;
$$;
create constraint trigger validate_membership after insert or update or delete on public.chat_members
  deferrable initially deferred for each row execute function public.validate_chat_membership();
create function public.validate_profile_membership() returns trigger
language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in select chat_id from chat_members where user_id = new.id loop perform public.check_chat_invariants(c); end loop;
  return null;
end;
$$;
create constraint trigger validate_role_membership after update on public.profiles
  deferrable initially deferred for each row execute function public.validate_profile_membership();
revoke execute on function public.check_chat_invariants(uuid) from public, anon, authenticated;

-- Leaving or handing over a chat must be one transaction so it always has an owner.
create function public.remove_chat_member(actor uuid, c uuid, target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare actor_role text; target_role text; target_member_role text; replacement uuid;
begin
  perform 1 from chats where id = c for update;
  select member_role into actor_role from chat_members where chat_id = c and user_id = actor;
  select p.role, m.member_role into target_role, target_member_role from chat_members m join profiles p on p.id = m.user_id where m.chat_id = c and m.user_id = target;
  if actor_role is null or target_member_role is null then raise exception 'Not a member'; end if;
  if actor <> target then
    if actor_role not in ('owner', 'manager') then raise exception 'Permission denied'; end if;
    if target_member_role = 'owner' then raise exception 'The owner must leave themselves'; end if;
    if target_role = 'teacher' and not exists(select 1 from profiles where id = actor and role = 'teacher') then raise exception 'Students cannot remove a teacher'; end if;
  end if;
  delete from chat_members where chat_id = c and user_id = target;
  delete from notifications where chat_id = c and user_id = target;
  if target_member_role = 'owner' then
    select m.user_id into replacement from chat_members m join profiles p on p.id = m.user_id
      where m.chat_id = c order by (p.role = 'teacher') desc, (m.member_role = 'manager') desc, m.joined_at limit 1;
    update chat_members set member_role = 'owner' where chat_id = c and user_id = replacement;
  end if;
end;
$$;
revoke execute on function public.remove_chat_member(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_chat_member(uuid, uuid, uuid) to service_role;

create function public.set_chat_member_role(actor uuid, c uuid, target uuid, requested text) returns void
language plpgsql security definer set search_path = public as $$
declare acting text; target_role text; target_membership text;
begin
  perform 1 from chats where id = c for update;
  select member_role into acting from chat_members where chat_id = c and user_id = actor;
  select p.role, m.member_role into target_role, target_membership from chat_members m join profiles p on p.id = m.user_id where m.chat_id = c and m.user_id = target;
  if acting is null or acting not in ('owner', 'manager') or target_membership is null then raise exception 'Permission denied'; end if;
  if requested not in ('owner', 'manager', 'member') then raise exception 'Invalid member role'; end if;
  if requested = 'owner' and acting <> 'owner' then raise exception 'Only the owner can transfer ownership'; end if;
  if target_membership = 'owner' and requested <> 'owner' then raise exception 'Transfer ownership before demoting the owner'; end if;
  if target_role = 'teacher' and not exists(select 1 from profiles where id = actor and role = 'teacher') then raise exception 'Students cannot change a teacher role'; end if;
  if requested = 'owner' then update chat_members set member_role = 'manager' where chat_id = c and member_role = 'owner' and user_id <> target; end if;
  update chat_members set member_role = requested where chat_id = c and user_id = target;
end;
$$;
revoke execute on function public.set_chat_member_role(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_chat_member_role(uuid, uuid, uuid, text) to service_role;

create or replace function public.spam_key(m public.messages) returns text
language sql immutable as $$
  select m.kind || ':' || coalesce(m.sticker_id::text, m.image_path, lower(regexp_replace(trim(m.body), '\s+', ' ', 'g')));
$$;

create function public.set_profile_role(actor uuid, target uuid, requested text) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid; next_teacher uuid;
begin
  perform pg_advisory_xact_lock(20261015, 1);
  if not exists(select 1 from profiles where id = actor and role = 'admin') then raise exception 'permission_denied: Admin access required'; end if;
  if requested not in ('student', 'teacher', 'moderator', 'admin') then raise exception 'Invalid role'; end if;
  if not exists(select 1 from profiles where id = target) then raise exception 'member_not_found: Account not found'; end if;
  if requested <> 'admin' and exists(select 1 from profiles where id = target and role = 'admin') and (select count(*) from profiles where role = 'admin') <= 1 then raise exception 'last_admin: Keep at least one administrator'; end if;
  update profiles set role = requested where id = target;
  for c in select chat_id from chat_members where user_id = target and member_role = 'owner' loop
    if requested <> 'teacher' then
      select m.user_id into next_teacher from chat_members m join profiles p on p.id = m.user_id where m.chat_id = c and p.role = 'teacher' order by m.joined_at limit 1;
      if next_teacher is not null then
        update chat_members set member_role = 'manager' where chat_id = c and user_id = target;
        update chat_members set member_role = 'owner' where chat_id = c and user_id = next_teacher;
      end if;
    end if;
  end loop;
end;
$$;
revoke execute on function public.set_profile_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_profile_role(uuid, uuid, text) to service_role;
