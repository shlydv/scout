-- Inline 128-byte binary-quantized copy of each product's search embedding.
-- Stage 1 of planned search ranks candidates by Hamming distance over these
-- bits (no TOAST reads); exact cosine runs only on the shortlist. Kept in sync
-- with product_search_index.embedding by trigger.
alter table public.product_facts add column if not exists embedding_bits bit(1024);

update public.product_facts f
set embedding_bits = binary_quantize(si.embedding)::bit(1024)
from public.product_search_index si
where si.product_id = f.product_id and si.embedding is not null
  and f.embedding_bits is distinct from binary_quantize(si.embedding)::bit(1024);

create or replace function public.product_facts_sync_embedding_bits() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  update public.product_facts
  set embedding_bits = case when new.embedding is null then null else binary_quantize(new.embedding)::bit(1024) end
  where product_id = new.product_id;
  return new;
end;
$$;

drop trigger if exists trg_product_facts_embedding_bits on public.product_search_index;
create trigger trg_product_facts_embedding_bits
  after insert or update of embedding on public.product_search_index
  for each row execute function public.product_facts_sync_embedding_bits();
