import { readFile, appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export type VariantImageCache = Map<string, string[]>;

const CACHE_PATH = resolve(process.cwd(), "data/cache/zepto-variant-images.jsonl");

export function variantImageCachePath(): string {
  return CACHE_PATH;
}

export async function loadVariantImageCache(): Promise<VariantImageCache> {
  const map: VariantImageCache = new Map();
  try {
    const text = await readFile(CACHE_PATH, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { variant_id: string; image_urls: string[] };
      if (row.variant_id && row.image_urls?.length) {
        map.set(row.variant_id, row.image_urls.filter(Boolean));
      }
    }
  } catch {
    // cold cache
  }
  return map;
}

export async function appendVariantImageCache(
  variantId: string,
  imageUrls: string[],
): Promise<void> {
  const urls = imageUrls.filter(Boolean);
  if (!urls.length) return;
  await mkdir(resolve(CACHE_PATH, ".."), { recursive: true });
  await appendFile(
    CACHE_PATH,
    `${JSON.stringify({ variant_id: variantId, image_urls: urls })}\n`,
  );
}
