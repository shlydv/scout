/**
 * Goal shelves: curated, always-fresh lists. Each shelf is a saved planned-search
 * query rendered as its own page (regenerated daily), so results stay grounded in
 * the same facts, filters and verification as search.
 */
export type Shelf = {
  slug: string;
  title: string;
  blurb: string;
  query: string;
  emoji: string;
};

export const SHELVES: Shelf[] = [
  { slug: "high-protein-snacks", emoji: "💪", title: "High-protein snacks", blurb: "Snacks that actually carry protein, most per 100g first.", query: "high protein snacks" },
  { slug: "kids-tiffin", emoji: "🎒", title: "Kids' tiffin picks", blurb: "Easy-to-pack snacks that aren't junk, checked for kid-friendliness.", query: "healthy tiffin snacks for kids, not too spicy" },
  { slug: "diabetic-friendly-breakfast", emoji: "🌅", title: "Diabetic-friendly breakfast", blurb: "Cereals, oats and mixes with little sugar, checked against the label.", query: "diabetic friendly breakfast with low sugar" },
  { slug: "low-sugar-biscuits", emoji: "🍪", title: "Lowest-sugar biscuits", blurb: "Every biscuit aisle, ranked by sugar per 100g.", query: "biscuits with the lowest sugar" },
  { slug: "namkeen-without-palm-oil", emoji: "🥨", title: "Namkeen without palm oil", blurb: "Namkeen whose label names a better oil than palm.", query: "namkeen without palm oil" },
  { slug: "no-added-sugar-drinks", emoji: "🥤", title: "Drinks with no added sugar", blurb: "Juices, milks and mixers with no sugar added.", query: "drinks with no added sugar" },
  { slug: "gluten-free-staples", emoji: "🌾", title: "Gluten-free staples", blurb: "Flours, grains and staples with no gluten-containing grains on the label.", query: "gluten free atta, flours and staples" },
  { slug: "healthier-instant-noodles", emoji: "🍜", title: "Healthier instant noodles", blurb: "Noodles that beat Maggi on Scout's health score.", query: "healthier than maggi" },
  { slug: "high-protein-dairy", emoji: "🥛", title: "High-protein dairy", blurb: "Curd, yogurt, paneer and milk with the most protein.", query: "high protein curd, yogurt, paneer and milk" },
  { slug: "jain-snacks", emoji: "🪷", title: "Jain snacks", blurb: "No onion, garlic or root vegetables on the label.", query: "jain snacks without onion, garlic or root vegetables" },
  { slug: "millet-picks", emoji: "🌱", title: "Millet picks", blurb: "Snacks and breakfasts made with ragi, jowar, bajra and other millets.", query: "millet based snacks and breakfast" },
  { slug: "cheapest-protein", emoji: "🪙", title: "Protein on a budget", blurb: "Affordable everyday sources of protein under ₹200.", query: "high protein foods under 200 rupees" },
];

export function shelfBySlug(slug: string): Shelf | undefined {
  return SHELVES.find(s => s.slug === slug);
}
