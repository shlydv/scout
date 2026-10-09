-- Per-product facts from the offline label pass (lib/facts). Concepts are a
-- closed vocabulary (lib/facts/vocab.ts). A concept listed in none of
-- present/may_contain/unknown is absent; the pass only allows that when the
-- ingredient list is complete, otherwise it lands in unknown.
create table if not exists public.product_facts (
  product_id uuid primary key references public.products (id) on delete cascade,
  facts_version int not null,
  ingredient_status text not null check (ingredient_status in ('complete', 'partial', 'garbage', 'missing')),
  present text[] not null default '{}',
  may_contain text[] not null default '{}',
  unknown text[] not null default '{}',
  claims text[] not null default '{}',
  conflicts text[] not null default '{}',
  veg text not null default 'unknown' check (veg in ('veg', 'non_veg', 'egg', 'unknown')),
  vegan boolean,
  jain boolean,
  kind text,
  ingredients text[] not null default '{}',
  evidence jsonb not null default '{}',
  pack_qty numeric,
  pack_unit text check (pack_unit in ('g', 'ml', 'pcs')),
  price_per_100 numeric,
  source_hash text not null,
  model text not null,
  built_at timestamptz not null default now()
);

create index if not exists product_facts_present_gin on public.product_facts using gin (present);
create index if not exists product_facts_claims_gin on public.product_facts using gin (claims);

alter table public.product_facts enable row level security;
revoke all on public.product_facts from anon, authenticated;
grant select on public.product_facts to service_role;
