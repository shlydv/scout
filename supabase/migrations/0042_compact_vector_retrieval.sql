-- Compact approximate candidate retrieval; full embeddings remain unchanged.
-- On a live database, build this index first with CREATE INDEX CONCURRENTLY
-- as a separate SQL statement, then apply this idempotent migration.
CREATE INDEX IF NOT EXISTS product_search_index_embedding_binary_hnsw
  ON public.product_search_index USING hnsw
  ((binary_quantize(embedding)::bit(1024)) bit_hamming_ops)
  WHERE embedding IS NOT NULL;

-- Load pgvector's user-settable GUCs in this session before defining SET options.
SELECT binary_quantize('[1,-1]'::vector);

CREATE OR REPLACE FUNCTION public.decision_search_candidates(
  p_query text, p_embedding vector(1024), p_limit integer DEFAULT 24
) RETURNS TABLE(row_json jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions SET hnsw.ef_search = 400 AS $$
  WITH shortlist AS MATERIALIZED (
    SELECT pi.product_id, pi.embedding
    FROM product_search_index pi
    WHERE p_embedding IS NOT NULL AND pi.embedding IS NOT NULL
    ORDER BY binary_quantize(pi.embedding)::bit(1024) <~> binary_quantize(p_embedding)::bit(1024)
    LIMIT 400
  ), semantic AS MATERIALIZED (
    SELECT pi.product_id, row_number() OVER (ORDER BY pi.embedding <=> p_embedding) AS position
    FROM shortlist pi JOIN products p ON p.id = pi.product_id
    WHERE p.catalog_visible IS TRUE
    ORDER BY pi.embedding <=> p_embedding
    LIMIT greatest(1, least(p_limit, 60))
  ), lexical AS MATERIALIZED (
    SELECT pi.product_id, row_number() OVER (
      ORDER BY ts_rank_cd(pi.search_tsv, websearch_to_tsquery('simple', p_query)) DESC, pi.product_id
    ) AS position
    FROM product_search_index pi
    JOIN products p ON p.id = pi.product_id
    WHERE p.catalog_visible IS TRUE
      AND pi.search_tsv @@ websearch_to_tsquery('simple', p_query)
    ORDER BY ts_rank_cd(pi.search_tsv, websearch_to_tsquery('simple', p_query)) DESC, pi.product_id
    LIMIT greatest(1, least(p_limit, 60))
  ), candidates AS (
    SELECT product_id, min(position) AS position
    FROM (SELECT * FROM semantic UNION ALL SELECT * FROM lexical) hits
    GROUP BY product_id
    ORDER BY min(position), product_id
    LIMIT greatest(1, least(p_limit, 60))
  )
  SELECT jsonb_build_object(
    'product_id', pi.product_id, 'canonical_product_id', pi.canonical_product_id,
    'slug', pi.slug, 'name', pi.name, 'brand', pi.brand,
    'category', pi.category, 'subcategory', pi.subcategory, 'primary_type', pi.primary_type,
    'scout_score', pi.scout_score, 'absolute_score', pi.absolute_score,
    'category_rank', pi.category_rank, 'category_size', pi.category_size, 'category_label', pi.category_label,
    'data_quality_score', pi.data_quality_score, 'data_completeness', pi.data_completeness
  )
  FROM candidates c JOIN product_search_index pi USING (product_id)
  ORDER BY c.position, c.product_id;
$$;
REVOKE ALL ON FUNCTION public.decision_search_candidates(text, vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decision_search_candidates(text, vector, integer) TO service_role;
