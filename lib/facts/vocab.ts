/**
 * Closed product-fact vocabulary shared by the offline facts pass and the
 * online search planner. The planner can only name these ids; the facts pass
 * decides, per product and from its full label, whether each one applies.
 * Synonyms ("maida", "palmolein", "INS 955") are resolved offline, never at
 * query time.
 */

export const CONCEPTS = {
  // Allergens and sources
  gluten_source: "Any gluten-containing grain or derivative: wheat (maida, atta, sooji/rava, durum, khapli/emmer, wheat gluten, soy sauce brewed with wheat), barley, rye, malt. Ragi/jowar/bajra/kuttu atta, rice rava and buckwheat are NOT gluten sources.",
  wheat: "Wheat in any form (maida, atta, sooji, durum, khapli, wheat starch/gluten/fibre).",
  oats: "Oats or oat derivatives.",
  dairy: "Milk-derived ingredient: milk, milk solids, whey, casein, lactose, butter, ghee, cream, curd, cheese, paneer, khoa.",
  egg: "Egg or egg derivatives.",
  soy: "Soy/soya in any form, including soy lecithin and soy sauce.",
  peanut: "Peanut/groundnut, including groundnut oil.",
  tree_nut: "Tree nuts: almond, cashew, pistachio, walnut, hazelnut, pecan, macadamia, brazil nut.",
  sesame: "Sesame/til/gingelly.",
  mustard: "Mustard seed, oil or powder.",
  sulphite: "Sulphites / sulphur dioxide (INS 220-228).",
  fish_seafood: "Fish, shellfish or seafood derivatives (incl. fish sauce).",
  meat: "Meat or poultry.",
  gelatin: "Gelatin or other animal-derived additives (e.g. carmine/INS 120, animal rennet if stated).",
  honey: "Honey.",
  onion_garlic: "Onion or garlic in any form.",
  root_vegetable: "Root/underground vegetables relevant to Jain diets: potato, onion, garlic, ginger, carrot, beetroot, radish, sweet potato.",
  // Fats
  palm_oil: "Palm oil, palmolein, palm kernel oil, or palm fat.",
  hydrogenated_fat: "Hydrogenated or partially hydrogenated fat, vanaspati, interesterified fat.",
  unspecified_oil: "An oil or fat whose source is not named (e.g. 'edible vegetable oil' with no source).",
  // Carbohydrates and sweeteners
  refined_flour: "Refined flour as a significant ingredient: maida / refined wheat flour, or other refined (non-whole) flours.",
  whole_grain: "A whole grain is a primary ingredient (whole wheat atta, oats, brown rice, millets, quinoa).",
  millet: "Millets: ragi, jowar, bajra, foxtail, kodo, little, barnyard (samak), proso, kuttu.",
  added_sugar: "Any added sugar or caloric sweetener: sugar, jaggery, honey, syrups, glucose, dextrose, fructose, invert sugar, maltodextrin, fruit juice concentrate used as sweetener, condensed milk.",
  artificial_sweetener: "Artificial sweeteners: sucralose, aspartame, acesulfame-K, saccharin, neotame (INS 950-962).",
  sugar_alcohol: "Polyols: maltitol, sorbitol, erythritol, xylitol, isomalt, lactitol.",
  natural_sweetener: "Non-caloric natural sweeteners: stevia, monk fruit.",
  // Additives
  artificial_colour: "Synthetic food colours (e.g. tartrazine, sunset yellow, INS 102/110/122/124/129/133, 'permitted synthetic food colours').",
  added_colour: "Any added colour, natural or synthetic, including caramel colour.",
  artificial_flavour: "Explicitly artificial flavouring substances.",
  added_flavour: "Any added flavouring (natural, nature-identical or artificial).",
  preservative: "Added chemical preservatives (benzoates, sorbates, nitrites, propionates, sulphites; INS 200-299).",
  flavour_enhancer: "Flavour enhancers: MSG / INS 621, INS 627, 631, 635.",
  caffeine: "Caffeine or caffeinated ingredients (coffee, tea, guarana, cola nut) in meaningful amount.",
  live_cultures: "Live/active probiotic cultures.",
  iodised_salt: "Iodised salt.",
  alcohol: "Alcohol as an ingredient.",
} as const;

export type ConceptId = keyof typeof CONCEPTS;
export const CONCEPT_IDS = Object.keys(CONCEPTS) as ConceptId[];

/** Normalized on-pack claims. "Other" claims are kept verbatim in claims_other. */
export const CLAIMS = {
  gluten_free: "Gluten free",
  no_palm_oil: "No palm oil / palm oil free",
  no_added_sugar: "No added sugar",
  sugar_free: "Sugar free / zero sugar",
  no_preservatives: "No (added) preservatives",
  no_artificial_colours: "No artificial colours",
  no_artificial_flavours: "No artificial flavours",
  no_maida: "No maida / no refined flour",
  vegan: "Vegan / plant based",
  organic: "Organic (certified or claimed)",
  high_protein: "High protein / rich in protein / source of protein",
  high_fibre: "High fibre / rich in fibre",
  low_fat: "Low fat / fat free",
  zero_trans_fat: "Zero trans fat",
  lactose_free: "Lactose free",
  keto: "Keto friendly",
  diabetic_friendly: "Diabetic friendly / suitable for diabetics / low GI",
  baked_not_fried: "Baked, not fried",
  whole_grain: "Whole grain / multigrain",
  non_gmo: "Non-GMO",
  jain: "Jain / no onion no garlic",
  kids: "Made for kids / children",
} as const;

export type ClaimId = keyof typeof CLAIMS;
export const CLAIM_IDS = Object.keys(CLAIMS) as ClaimId[];

/** Numeric product fields the planner may filter or sort on (per 100 g/ml unless noted). */
export const NUMERIC_FIELDS = {
  price_inr: "Pack price in INR",
  price_per_100: "Price per 100 g or 100 ml in INR",
  pack_qty: "Pack quantity in g or ml",
  energy_kcal: "Energy kcal/100g",
  protein_g: "Protein g/100g",
  sugar_g: "Total sugar g/100g",
  added_sugar_g: "Added sugar g/100g",
  fat_g: "Fat g/100g",
  saturated_fat_g: "Saturated fat g/100g",
  carbs_g: "Carbohydrate g/100g",
  fiber_g: "Fibre g/100g",
  sodium_mg: "Sodium mg/100g",
  protein_per_100kcal: "Protein grams per 100 kcal (protein density)",
  scout_score: "Scout health score 0-100 (higher is healthier)",
} as const;

export type NumericField = keyof typeof NUMERIC_FIELDS;
export const NUMERIC_FIELD_IDS = Object.keys(NUMERIC_FIELDS) as NumericField[];

/** Short shopper-facing names, e.g. for "No palm oil" chips. */
export const CONCEPT_LABELS: Record<ConceptId, string> = {
  gluten_source: "gluten", wheat: "wheat", oats: "oats", dairy: "dairy", egg: "egg", soy: "soy", peanut: "peanut",
  tree_nut: "tree nuts", sesame: "sesame", mustard: "mustard", sulphite: "sulphites", fish_seafood: "fish/seafood",
  meat: "meat", gelatin: "gelatin", honey: "honey", onion_garlic: "onion/garlic", root_vegetable: "root vegetables",
  palm_oil: "palm oil", hydrogenated_fat: "hydrogenated fat", unspecified_oil: "unnamed oils", refined_flour: "maida",
  whole_grain: "whole grains", millet: "millets", added_sugar: "added sugar", artificial_sweetener: "artificial sweeteners",
  sugar_alcohol: "sugar alcohols", natural_sweetener: "stevia/monk fruit", artificial_colour: "artificial colours",
  added_colour: "added colours", artificial_flavour: "artificial flavours", added_flavour: "added flavours",
  preservative: "preservatives", flavour_enhancer: "MSG/flavour enhancers", caffeine: "caffeine",
  live_cultures: "live cultures", iodised_salt: "iodised salt", alcohol: "alcohol",
};

/** Short shopper-facing names for numeric fields. */
export const NUMERIC_LABELS: Record<NumericField, { label: string; unit: string }> = {
  price_inr: { label: "Price", unit: "₹" }, price_per_100: { label: "Price/100g", unit: "₹" }, pack_qty: { label: "Pack", unit: "g" },
  energy_kcal: { label: "Calories", unit: "kcal" }, protein_g: { label: "Protein", unit: "g" }, sugar_g: { label: "Sugar", unit: "g" },
  added_sugar_g: { label: "Added sugar", unit: "g" }, fat_g: { label: "Fat", unit: "g" }, saturated_fat_g: { label: "Sat. fat", unit: "g" },
  carbs_g: { label: "Carbs", unit: "g" }, fiber_g: { label: "Fibre", unit: "g" }, sodium_mg: { label: "Sodium", unit: "mg" },
  protein_per_100kcal: { label: "Protein per 100 kcal", unit: "g" }, scout_score: { label: "Scout score", unit: "" },
};
