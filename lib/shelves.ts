/**
 * Goal shelves: curated, always-fresh lists. Each shelf is a saved planned-search
 * query rendered as its own page (regenerated daily), so results stay grounded in
 * the same facts, filters and verification as search. `note` is the shelf's
 * one-paragraph "how we picked these" — keep it plain and true to what the
 * search actually checks.
 */
export type ShelfMetric = "protein" | "sugar";

export type Shelf = {
  slug: string;
  title: string;
  blurb: string;
  note: string;
  query: string;
  /** Nutrient shown next to each pick. */
  metric?: ShelfMetric;
  /** "score" re-ranks healthiest first; otherwise the search's own order (e.g. most protein). */
  rankBy?: "score";
};

export const SHELVES: Shelf[] = [
  {
    slug: "high-protein-snacks", title: "High-protein snacks", metric: "protein",
    blurb: "Snacks that actually carry protein, most per 100g first.",
    note: "Sorted by grams of protein per 100g, straight off the nutrition panel. The score is there for everything else that comes along — a 30g-protein chip can still be a treat.",
    query: "high protein snacks",
  },
  {
    slug: "kids-tiffin", rankBy: "score", title: "Kids' tiffin picks", metric: "sugar",
    blurb: "Easy-to-pack snacks that aren't junk.",
    note: "Things that survive a school bag and aren't a sugar hit. We asked for not-too-spicy and checked each pick against its label.",
    query: "healthy tiffin snacks for kids, not too spicy",
  },
  {
    slug: "diabetic-friendly-breakfast", title: "Diabetic-friendly breakfast", metric: "sugar",
    blurb: "Cereals, oats and mixes with little sugar.",
    note: "Breakfast cereals, oats and mixes with the least sugar on the panel. We only read sugar and the ingredient list — ask your doctor about carbs.",
    query: "diabetic friendly breakfast with low sugar",
  },
  {
    slug: "low-sugar-biscuits", title: "Lowest-sugar biscuits", metric: "sugar",
    blurb: "Every biscuit aisle, ranked by sugar per 100g.",
    note: "Every biscuit we've read, least sugar first. A “sugar free” pack only makes it here if its own nutrition panel agrees.",
    query: "biscuits with the lowest sugar",
  },
  {
    slug: "namkeen-without-palm-oil", rankBy: "score", title: "Namkeen without palm oil",
    blurb: "No palm oil or palmolein on the ingredient list.",
    note: "Namkeen with no palm oil or palmolein on the label. If a pack only says “edible vegetable oil” we can't tell what's in it, so it isn't on this shelf.",
    query: "namkeen without palm oil",
  },
  {
    slug: "no-added-sugar-drinks", rankBy: "score", title: "Drinks with no added sugar", metric: "sugar",
    blurb: "Juices, milks and mixers with no sugar added.",
    note: "Nothing sweet in the ingredient list — no sugar, syrups or jaggery. Fruit juices still carry their own sugar, so check the number next to each.",
    query: "drinks with no added sugar",
  },
  {
    slug: "gluten-free-staples", rankBy: "score", title: "Gluten-free staples",
    blurb: "Flours, grains and staples with no gluten grains on the label.",
    note: "No wheat, barley, rye or maida in the ingredients. We don't test for cross-contamination — if it's coeliac-serious, look for a certified mark on the pack.",
    query: "gluten free atta, flours and staples",
  },
  {
    slug: "healthier-instant-noodles", rankBy: "score", title: "Healthier instant noodles",
    blurb: "Noodles that beat Maggi on Scout's score.",
    note: "Instant noodles that score higher than plain Maggi. Most are still maida and palm oil — the bar is low, and this shelf says so.",
    query: "healthier than maggi",
  },
  {
    slug: "high-protein-dairy", title: "High-protein dairy", metric: "protein",
    blurb: "Curd, yogurt, paneer and milk with the most protein.",
    note: "Curd, yogurt, paneer and milk, most protein first. Flavoured cups often hide sugar; the score catches it.",
    query: "high protein curd, yogurt, paneer and milk",
  },
  {
    slug: "jain-snacks", rankBy: "score", title: "Jain snacks",
    blurb: "No onion, garlic or root vegetables on the label.",
    note: "No onion, garlic, potato or other root vegetables in the ingredients. Vague lines like “spices” or “condiments” keep a pack off this shelf.",
    query: "jain snacks without onion, garlic or root vegetables",
  },
  {
    slug: "millet-picks", rankBy: "score", title: "Millet picks",
    blurb: "Ragi, jowar, bajra and other millets.",
    note: "Snacks and breakfasts where a millet is actually in the ingredients, not just on the front of the pack.",
    query: "millet based snacks and breakfast",
  },
  {
    slug: "cheapest-protein", title: "Protein on a budget", metric: "protein",
    blurb: "Everyday sources of protein under ₹200.",
    note: "Everyday protein for under ₹200 a pack — dals, soya, paneer, peanuts. Sorted by protein, so check price per kilo before you stock up.",
    query: "high protein foods under 200 rupees",
  },
];

export function shelfBySlug(slug: string): Shelf | undefined {
  return SHELVES.find(s => s.slug === slug);
}

/** How a shelf's list is ordered, in words. */
export function shelfOrderLabel(shelf: Shelf): string {
  if (shelf.rankBy === "score") return "healthiest first";
  if (shelf.metric === "protein") return "most protein first";
  if (shelf.metric === "sugar") return "least sugar first";
  return "best first";
}
