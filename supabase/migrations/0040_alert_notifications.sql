-- In-app alert inbox for saved-search match notifications.

create table if not exists public.alert_notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  alert_id      uuid references public.search_alerts (id) on delete set null,
  query         text not null,
  new_matches   int not null default 0,
  previous      int not null default 0,
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);

create index if not exists alert_notifications_user_unread_idx
  on public.alert_notifications (user_id, created_at desc)
  where read_at is null;

alter table public.alert_notifications enable row level security;

drop policy if exists "users_select_own_alert_notifications" on public.alert_notifications;
create policy "users_select_own_alert_notifications" on public.alert_notifications
  for select using (auth.uid() = user_id);

drop policy if exists "users_update_own_alert_notifications" on public.alert_notifications;
create policy "users_update_own_alert_notifications" on public.alert_notifications
  for update using (auth.uid() = user_id);
