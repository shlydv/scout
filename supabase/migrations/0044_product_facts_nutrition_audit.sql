-- Nutrition sanity verdict from the facts audit pass: label numbers that cannot be
-- right given the ingredients (e.g. OCR swapped protein/carbs). Suspect values are
-- never used to rank or filter as if they were confirmed.
alter table public.product_facts
  add column if not exists nutrition_suspect boolean,
  add column if not exists nutrition_note text;
