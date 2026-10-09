-- Pack-size variant grouping (lib/facts/variant-key.ts): products that differ only
-- in size or packaging share a key, so results show one card with "N sizes"
-- instead of the same product repeated. Flavours keep distinct keys.
alter table public.product_facts add column if not exists variant_key text;
create index if not exists product_facts_variant_key_idx on public.product_facts (variant_key);
