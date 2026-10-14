-- Product key, L3 category and data source columns.

alter table public.products
  add column if not exists l3_category text;

alter table public.products
  add column if not exists product_key text;

alter table public.products
  add column if not exists data_source text not null default 'scrape';

create unique index if not exists products_product_key_uniq
  on public.products (product_key)
  where product_key is not null;

-- Rows identified by product_key may not have a platform SKU.
alter table public.products
  alter column zepto_sku drop not null;

comment on column public.products.product_key is
  'Stable hash key from brand + name + pack + l3.';
comment on column public.products.l3_category is
  'L3 / use-case category name.';
comment on column public.products.data_source is
  'Where the row came from.';
