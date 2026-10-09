-- Planner output cache shared across serverless instances. Keyed by the
-- normalized query + preferences + planner version; repeat searches skip the
-- planner call (~1.5 s). Rows are small and expire by age.
create table if not exists public.search_plan_cache (
  cache_key text primary key,
  plan jsonb not null,
  dropped text[] not null default '{}',
  hits int not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz
);
create index if not exists search_plan_cache_created_idx on public.search_plan_cache (created_at);

alter table public.search_plan_cache enable row level security;
revoke all on public.search_plan_cache from anon, authenticated;
grant select on public.search_plan_cache to scout_ro;
