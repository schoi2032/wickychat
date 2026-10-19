-- Notification previews
create function public.redact_hidden_message_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'hidden' and old.status is distinct from 'hidden' then
    update notifications set body = 'Message removed', read_at = coalesce(read_at, now()) where message_id = new.id;
  end if;
  return new;
end;
$$;
create trigger after_message_hidden after update of status on public.messages
  for each row execute function public.redact_hidden_message_notifications();
