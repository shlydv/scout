-- Catalog visibility keeps two facts apart:
--  * hidden_reason: a person took the product off the site. Setting it hides the product,
--    the visibility backfill never shows it again, and the check makes that a database rule.
--  * catalog_checked_at: when catalog_visible was last computed from the product's data.
--    Any change to those inputs clears it, so stale rows are countable and the backfill
--    rechecks only them.
alter table public.products
  add column if not exists hidden_reason text,
  add column if not exists catalog_checked_at timestamptz;

alter table public.products
  drop constraint if exists products_hidden_not_visible;
alter table public.products
  add constraint products_hidden_not_visible
  check (hidden_reason is null or not catalog_visible);

comment on column public.products.hidden_reason is
  'Why a person took this product off the site. Null means visibility follows the data rules.';
comment on column public.products.catalog_checked_at is
  'When catalog_visible was last computed. Null means the inputs changed since, or it was never computed.';

create or replace function public.products_visibility_state()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (new.name, new.super_category, new.category, new.subcategory, new.ingredients_raw, new.nutrition)
         is distinct from
         (old.name, old.super_category, old.category, old.subcategory, old.ingredients_raw, old.nutrition) then
    new.catalog_checked_at := null;
  end if;
  if new.hidden_reason is not null then
    new.catalog_visible := false;
  end if;
  return new;
end;
$$;
-- Named to run after preserve_reviewed_nutrition, so a kept reviewed panel is not a change.
drop trigger if exists products_visibility_state on public.products;
create trigger products_visibility_state
before insert or update on public.products
for each row execute function public.products_visibility_state();

create or replace function public.forbid_product_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Products cannot be deleted. Set hidden_reason to take a product off the site.';
end;
$$;
