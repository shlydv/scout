/** Map catalog list items onto the shared product-card shape used by search. */
import { resolveProductVerdict } from "@/lib/scoring/verdict-resolve";
import type { SearchCard } from "@/lib/search/planned/present";
import type { CatalogGridItem } from "@/lib/products/queries";

export function gridItemToCard(item: CatalogGridItem): SearchCard {
  const cs = item.core_scores;
  const score = cs?.absolute_score ?? cs?.score ?? null;
  return {
    id: item.id, slug: item.slug, name: item.name, brand: item.brand,
    image: item.image_urls?.[0] ?? null,
    price_inr: item.price_inr, mrp_inr: item.mrp_inr, net_weight: item.net_weight, price_per_100: null,
    score,
    verdict: resolveProductVerdict({ verdict: cs?.verdict, score, name: item.name, category: item.category, subcategory: item.subcategory }),
    rank: cs?.category_rank && cs.category_size ? { rank: cs.category_rank, size: cs.category_size, label: cs.category_label ?? null } : null,
    reasons: [], warning: null, fit: null,
    sizes: item.sizes ?? [],
    nutrition: { protein_g: null, sugar_g: null, kcal: null },
  };
}
