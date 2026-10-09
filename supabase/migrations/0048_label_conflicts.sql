-- Verified "front of pack vs back label" contradictions (scripts/facts-conflicts.ts).
-- Built from product_facts.conflicts; only clear, defensible cases are kept, so
-- these can be shown publicly as evidence-backed callouts.
create table if not exists public.label_conflicts (
  product_id uuid not null references public.products (id) on delete cascade,
  claim text not null,
  reality text not null,
  kind text not null check (kind in ('sugar', 'gluten', 'palm_oil', 'preservative', 'colour', 'flavour', 'msg', 'trans_fat', 'egg', 'dairy', 'maida', 'sweetener', 'other')),
  severity text not null check (severity in ('high', 'medium')),
  source_hash text not null,
  verified_at timestamptz not null default now(),
  primary key (product_id, claim)
);
create index if not exists label_conflicts_kind_idx on public.label_conflicts (kind, severity);

alter table public.label_conflicts enable row level security;
revoke all on public.label_conflicts from anon, authenticated;
grant select on public.label_conflicts to scout_ro;
