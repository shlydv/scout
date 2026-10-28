-- Keep a human-checked source of truth when automatic scraping/OCR reimports
-- older numbers. A deliberate new review must carry a new values snapshot.
-- Other product fields and derived serving metadata can still be refreshed.
create or replace function public.preserve_reviewed_nutrition()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.nutrition->'extra'->>'manual_review_status' in ('verified', 'partial', 'label_conflict')
     and old.nutrition->'extra'->>'manual_review_snapshot' is not null
     and old.nutrition->'extra'->>'manual_review_sources' is not null
     and (new.nutrition->'extra'->>'manual_review_snapshot' is null
          or coalesce(new.nutrition->'extra'->>'manual_review_status', '') not in ('verified', 'partial', 'label_conflict')
          or new.nutrition->'extra'->>'manual_review_sources' is null
          or ((new.nutrition - 'extra' - 'source') is distinct from (old.nutrition - 'extra' - 'source')
              and new.nutrition->'extra'->>'manual_review_snapshot' = old.nutrition->'extra'->>'manual_review_snapshot')) then
    new.nutrition := old.nutrition;
  end if;
  return new;
end;
$$;
drop trigger if exists preserve_reviewed_nutrition on public.products;
create trigger preserve_reviewed_nutrition
before update of nutrition on public.products
for each row execute function public.preserve_reviewed_nutrition();
