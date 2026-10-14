import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseZeptoDetailPayload } from "@/lib/grocery/parse-zepto-detail";
import { makeThrottledFetch, sleep } from "@/lib/grocery/http";
import { isZeptoVariantId } from "@/lib/zepto/variant-id";
import {
  appendVariantImageCache,
  loadVariantImageCache,
  type VariantImageCache,
} from "@/lib/zepto/variant-images-cache";

export type { VariantImageCache } from "@/lib/zepto/variant-images-cache";
export { loadVariantImageCache };

const API = (
  process.env.ZEPTO_BFF_URL ??
  process.env.NEXT_PUBLIC_ZEPTO_CF_BFF_URL ??
  "https://bff-gateway.zepto.com/"
).replace(/\/?$/, "/");
const PAS = "product-assortment-service/api";

type SessionHeaders = Record<string, string>;

async function loadZeptoSession(): Promise<{ storeId: string; headers: SessionHeaders }> {
  const raw = await readFile(resolve(".cache/zepto-session.json"), "utf8");
  const session = JSON.parse(raw) as { headers: SessionHeaders };
  const storeId =
    session.headers.store_id ??
    session.headers.storeid ??
    process.env.ZEPTO_STORE_ID ??
    "";
  if (!storeId) throw new Error("No store_id in .cache/zepto-session.json — run pnpm warm-session");
  return { storeId, headers: session.headers };
}

/** Fetch product images from Zepto BFF (fast JSON — no PDP HTML). */
export async function fetchVariantImagesFromBff(
  variantId: string,
  session: { storeId: string; headers: SessionHeaders },
  http = makeThrottledFetch({ rps: Number(process.env.ZEPTO_IMAGE_RPS ?? 4), burst: 2 }),
): Promise<string[]> {
  const url =
    `${API}${PAS}/v2/product-detail` +
    `?storeId=${encodeURIComponent(session.storeId)}` +
    `&productVariantId=${encodeURIComponent(variantId)}`;

  const res = await http(url, {
    headers: {
      ...session.headers,
      accept: "application/json",
      origin: "https://www.zepto.com",
      referer: "https://www.zepto.com/",
    },
    label: `zepto/img/${variantId.slice(0, 8)}`,
    retries: 2,
    failFast429: true,
  });

  if (!res.ok) return [];
  const data = (await res.json()) as Record<string, unknown>;
  return parseZeptoDetailPayload(variantId, data).image_urls;
}

export async function resolveVariantImages(opts: {
  variantIds: string[];
  cache: VariantImageCache;
  skipFetch?: boolean;
  onProgress?: (done: number, total: number, fetched: number) => void;
}): Promise<VariantImageCache> {
  const out = new Map(opts.cache);
  const missing = opts.variantIds.filter((id) => isZeptoVariantId(id) && !out.has(id));
  console.log(
    `[variant-images] cached=${out.size} missing=${missing.length} total=${opts.variantIds.length}`,
  );
  if (opts.skipFetch || !missing.length) return out;

  let session: { storeId: string; headers: SessionHeaders };
  try {
    session = await loadZeptoSession();
  } catch (e) {
    console.warn("[variant-images] skip BFF fetch:", (e as Error).message);
    return out;
  }

  const http = makeThrottledFetch({
    rps: Number(process.env.ZEPTO_IMAGE_RPS ?? 4),
    burst: 2,
  });

  let fetched = 0;
  let consecutive429 = 0;
  for (let i = 0; i < missing.length; i++) {
    const id = missing[i];
    try {
      const urls = await fetchVariantImagesFromBff(id, session, http);
      if (urls.length) {
        out.set(id, urls);
        await appendVariantImageCache(id, urls);
        fetched++;
        consecutive429 = 0;
      }
    } catch (err) {
      if (/429/.test((err as Error).message)) {
        consecutive429++;
        if (consecutive429 >= 3) {
          console.warn("[variant-images] 429 storm — pausing 60s…");
          await sleep(60_000);
          consecutive429 = 0;
        }
      }
    }
    if ((i + 1) % 200 === 0 || i + 1 === missing.length) {
      opts.onProgress?.(i + 1, missing.length, fetched);
      console.log(
        `[variant-images] ${i + 1}/${missing.length} resolved (new=${fetched}, cached=${opts.cache.size})`,
      );
    }
  }

  return out;
}
