import type { ProductSearchIndexRow } from "@/lib/search/v2/types";

export function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as number[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function mapDbRow(raw: Record<string, unknown>): ProductSearchIndexRow {
  return {
    product_id: String(raw.product_id),
    canonical_product_id: raw.canonical_product_id ? String(raw.canonical_product_id) : null,
    slug: String(raw.slug),
    name: String(raw.name),
    brand: (raw.brand as string) ?? null,
    category: (raw.category as string) ?? null,
    subcategory: (raw.subcategory as string) ?? null,
    l3_category: (raw.l3_category as string) ?? null,
    primary_type: (raw.primary_type as string) ?? null,
    base_name: (raw.base_name as string) ?? null,
    form: (raw.form as string) ?? null,
    flavours: (raw.flavours as string[]) ?? [],
    variants: (raw.variants as string[]) ?? [],
    is_veg: (raw.is_veg as boolean) ?? null,
    is_vegan: (raw.is_vegan as boolean) ?? null,
    is_gluten_free: (raw.is_gluten_free as boolean) ?? null,
    is_jain: (raw.is_jain as boolean) ?? null,
    is_palm_oil_free: (raw.is_palm_oil_free as boolean) ?? null,
    has_added_sugar: (raw.has_added_sugar as boolean) ?? null,
    allergens: (raw.allergens as string[]) ?? [],
    claims: (raw.claims as string[]) ?? [],
    sugar_g: raw.sugar_g != null ? Number(raw.sugar_g) : null,
    protein_g: raw.protein_g != null ? Number(raw.protein_g) : null,
    fat_g: raw.fat_g != null ? Number(raw.fat_g) : null,
    saturated_fat_g: raw.saturated_fat_g != null ? Number(raw.saturated_fat_g) : null,
    calcium_mg: raw.calcium_mg != null ? Number(raw.calcium_mg) : null,
    iron_mg: raw.iron_mg != null ? Number(raw.iron_mg) : null,
    fiber_g: raw.fiber_g != null ? Number(raw.fiber_g) : null,
    carbs_g: raw.carbs_g != null ? Number(raw.carbs_g) : null,
    sodium_mg: raw.sodium_mg != null ? Number(raw.sodium_mg) : null,
    energy_kcal: raw.energy_kcal != null ? Number(raw.energy_kcal) : null,
    total_protein_g: raw.total_protein_g != null ? Number(raw.total_protein_g) : null,
    total_sugar_g: raw.total_sugar_g != null ? Number(raw.total_sugar_g) : null,
    total_fat_g: raw.total_fat_g != null ? Number(raw.total_fat_g) : null,
    total_calories: raw.total_calories != null ? Number(raw.total_calories) : null,
    price_inr: raw.price_inr != null ? Number(raw.price_inr) : null,
    sugar_tier: (raw.sugar_tier as ProductSearchIndexRow["sugar_tier"]) ?? null,
    protein_tier: (raw.protein_tier as ProductSearchIndexRow["protein_tier"]) ?? null,
    fat_tier: (raw.fat_tier as ProductSearchIndexRow["fat_tier"]) ?? null,
    traits: (raw.traits as ProductSearchIndexRow["traits"]) ?? {},
    trait_source: (raw.trait_source as ProductSearchIndexRow["trait_source"]) ?? {},
    trait_confidence: (raw.trait_confidence as ProductSearchIndexRow["trait_confidence"]) ?? {},
    trait_reasons: (raw.trait_reasons as ProductSearchIndexRow["trait_reasons"]) ?? {},
    scout_score: raw.scout_score != null ? Number(raw.scout_score) : null,
    absolute_score: raw.absolute_score != null ? Number(raw.absolute_score) : null,
    category_rank: raw.category_rank != null ? Number(raw.category_rank) : null,
    category_size: raw.category_size != null ? Number(raw.category_size) : null,
    category_label: (raw.category_label as string) ?? null,
    nova_group: raw.nova_group != null ? Number(raw.nova_group) : null,
    data_quality_score: Number(raw.data_quality_score ?? 0),
    data_completeness: Number(raw.data_completeness ?? 0),
    facet_confidence: (raw.facet_confidence as Record<string, number>) ?? {},
    brand_tier: (raw.brand_tier as string) ?? null,
    pack_size_value: raw.pack_size_value != null ? Number(raw.pack_size_value) : null,
    pack_size_unit: (raw.pack_size_unit as string) ?? null,
    use_cases: (raw.use_cases as string[]) ?? [],
    search_doc: (raw.search_doc as string) ?? null,
    embedding: parseVector(raw.embedding),
    type_embedding: parseVector(raw.type_embedding),
    click_count: Number(raw.click_count ?? 0),
    save_count: Number(raw.save_count ?? 0),
    last_interaction_at: (raw.last_interaction_at as string) ?? null,
    built_at: (raw.built_at as string) ?? null,
    source_hash: (raw.source_hash as string) ?? null,
  };
}
