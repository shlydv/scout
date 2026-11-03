-- Old product URLs keep working when a slug changes. Every slug a product used to
-- have points at the product; the app sends visitors on to its current slug.
-- The trigger below records the old slug on every change, so renames need no
-- extra bookkeeping. Rows are never removed except when a slug comes back into use.
create table if not exists public.product_slug_redirects (
  old_slug text primary key,
  product_id uuid not null references public.products (id),
  created_at timestamptz not null default now()
);
create index if not exists product_slug_redirects_product_idx
  on public.product_slug_redirects (product_id);

-- Private: clients look up one slug at a time through current_product_slugs().
alter table public.product_slug_redirects enable row level security;
revoke all on public.product_slug_redirects from anon, authenticated;
grant select on public.product_slug_redirects to scout_ro;

-- Current slug for each given slug a product has moved away from.
create or replace function public.current_product_slugs(p_slugs text[])
returns table (old_slug text, slug text)
language sql stable security definer set search_path = public as $$
  select r.old_slug, p.slug
  from public.product_slug_redirects r
  join public.products p on p.id = r.product_id
  where r.old_slug = any (p_slugs)
$$;
revoke all on function public.current_product_slugs(text[]) from public;
grant execute on function public.current_product_slugs(text[]) to anon, authenticated, service_role, scout_ro;

create or replace function public.record_product_slug_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A slug that is live again is no longer a redirect.
  delete from public.product_slug_redirects where old_slug = new.slug;
  insert into public.product_slug_redirects (old_slug, product_id)
  values (old.slug, old.id)
  on conflict (old_slug) do update set product_id = excluded.product_id, created_at = now();
  -- Tables that keep their own copy of the slug.
  update public.product_search_index set slug = new.slug where product_id = new.id;
  if to_regclass('public.saved_products') is not null then
    update public.saved_products set product_slug = new.slug where product_slug = old.slug;
  end if;
  return null;
end;
$$;

drop trigger if exists products_slug_redirect on public.products;
create trigger products_slug_redirect
after update of slug on public.products
for each row when (old.slug is distinct from new.slug)
execute function public.record_product_slug_change();
