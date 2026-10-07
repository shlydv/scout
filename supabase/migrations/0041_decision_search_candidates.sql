-- Migration 0039 removed this index when the previous blended ranking did not use it.
-- The new retrieval predicate uses @@, so restore its small GIN index.
CREATE INDEX IF NOT EXISTS product_search_index_search_tsv_idx
  ON public.product_search_index USING gin(search_tsv);

-- Retrieval only: no dietary, brand, goal, numeric or confidence filters.
-- Use existing HNSW and FTS indexes; return bounded rows without vectors.
CREATE OR REPLACE FUNCTION public.decision_search_candidates(
  p_query text, p_embedding vector(1024), p_limit integer DEFAULT 24
) RETURNS TABLE(row_json jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions AS $$
  WITH semantic AS MATERIALIZED (
    SELECT pi.product_id, row_number() OVER (ORDER BY pi.embedding <=> p_embedding) AS position
    FROM product_search_index pi
    JOIN products p ON p.id = pi.product_id
    WHERE p_embedding IS NOT NULL AND pi.embedding IS NOT NULL AND p.catalog_visible IS TRUE
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
