-- Saved-search alerts have one switch and one state row.
--  * saved_searches.alert_enabled is the only on/off switch. search_alerts.active is no
--    longer read for saved searches; the runner creates the state row on its first run.
--  * One state row per saved search, so two runs of the same alert cannot both notify.
--  * seen_product_ids lists the products the alert has already reported. It is null until
--    the first run records what matches at that point; later runs report only products
--    that are not in it.
do $$
begin
  if exists (
    select 1 from public.search_alerts
    where saved_search_id is not null
    group by saved_search_id having count(*) > 1
  ) then
    raise exception 'search_alerts has more than one row for a saved search. Keep one row per saved_search_id, then apply this migration again.';
  end if;
end $$;

create unique index if not exists search_alerts_saved_search_key
  on public.search_alerts (saved_search_id);

alter table public.search_alerts
  add column if not exists seen_product_ids uuid[];

comment on column public.search_alerts.seen_product_ids is
  'Products this alert has already reported. Null until the first run records a baseline.';
comment on column public.search_alerts.active is
  'Not read for saved-search alerts; saved_searches.alert_enabled is the switch.';
