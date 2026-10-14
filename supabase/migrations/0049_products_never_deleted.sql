-- Products are never deleted. To take one off the site, set catalog_visible = false.
-- Blocks DELETE and TRUNCATE from every client (scripts, PostgREST, SQL editor).
-- Removing this guard takes a deliberate migration that drops both triggers.

create or replace function public.forbid_product_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Products cannot be deleted. Set catalog_visible = false to hide a product.';
end;
$$;

drop trigger if exists products_no_delete on public.products;
create trigger products_no_delete
  before delete on public.products
  for each row execute function public.forbid_product_delete();

drop trigger if exists products_no_truncate on public.products;
create trigger products_no_truncate
  before truncate on public.products
  for each statement execute function public.forbid_product_delete();

comment on column public.products.product_key is 'Stable hash key from brand + name + pack + l3.';
comment on column public.products.l3_category is 'L3 / use-case category name.';
comment on column public.products.data_source is 'Where the row came from.';
