/** Selling price for UI; falls back to MRP when there is no separate selling price. */
export function displayPriceInr(product: {
  price_inr: number | null;
  mrp_inr?: number | null;
}): number | null {
  return product.price_inr ?? product.mrp_inr ?? null;
}

export function showMrpStrike(product: {
  price_inr: number | null;
  mrp_inr?: number | null;
}): boolean {
  const price = product.price_inr;
  const mrp = product.mrp_inr;
  return price != null && mrp != null && mrp > price;
}
