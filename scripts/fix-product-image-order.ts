#!/usr/bin/env -S pnpm tsx
/**
 * Detect products whose first image is likely a back label / wrong frame; reorder in DB.
 *
 *   pnpm catalog:fix-images -- --dry-run
 *   pnpm catalog:fix-images -- --apply --limit=500
 *   pnpm catalog:fix-images -- --apply --refetch-bff   # replace from Zepto BFF when sku known
 */
import { config as loadEnv } from "dotenv";
import { adminClient } from "@/lib/supabase/admin";
import {
  dedupeImageUrls,
  needsHeroReorder,
  normalizeProductImageUrls,
} from "@/lib/products/catalog-hero-image";
import { fetchVariantImagesFromBff, loadVariantImageCache } from "@/lib/zepto/fetch-variant-images";
import { isZeptoVariantId } from "@/lib/zepto/variant-id";
import { makePlaywrightFetch, closePlaywrightFetch } from "@/lib/grocery/http-playwright";

loadEnv({ path: ".env.local" });

type Row = {
  id: string;
  slug: string;
  zepto_sku: string | null;
  image_urls: string[] | null;
  ocr_image_url: string | null;
};

function parseArgs() {
  const argv = process.argv.slice(2);
  let limit: number | null = null;
  for (const a of argv) {
    if (a.startsWith("--limit=")) limit = Number(a.split("=")[1]);
  }
  return {
    limit,
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
    apply: argv.includes("--apply"),
    refetchBff: argv.includes("--refetch-bff"),
  };
}

async function loadZeptoSession(): Promise<{ storeId: string; headers: Record<string, string> } | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const raw = await readFile(resolve(".cache/zepto-session.json"), "utf8");
    const session = JSON.parse(raw) as { headers: Record<string, string> };
    const storeId =
      session.headers.store_id ?? session.headers.storeid ?? process.env.ZEPTO_STORE_ID ?? "";
    if (!storeId) return null;
    return { storeId, headers: session.headers };
  } catch {
    return null;
  }
}

async function main() {
  const { limit, dryRun, apply, refetchBff } = parseArgs();
  const supabase = adminClient();

  const pageSize = 400;
  let offset = 0;
  let scanned = 0;
  let flagged = 0;
  let updated = 0;
  let refetched = 0;

  const session = refetchBff ? await loadZeptoSession() : null;
  if (refetchBff && !session) {
    console.warn("[fix-images] --refetch-bff needs .cache/zepto-session.json — URL reorder only");
  }

  // Zepto's BFF sits behind Cloudflare; a plain HTTP client gets 429'd on every
  // request. Route through the Playwright storage-state context (the same
  // __cf_bm-bound TLS the scrapers use). Slow + gentle: ~2 rps.
  const bffHttp = (refetchBff && session)
    ? makePlaywrightFetch({
        storageStatePath: ".cache/zepto-storage.json",
        origin: "https://www.zepto.com",
        rps: Number(process.env.ZEPTO_IMAGE_RPS ?? 2),
        burst: 1,
      })
    : undefined;

  const imageCache = refetchBff ? await loadVariantImageCache() : new Map<string, string[]>();

  while (true) {
    if (limit != null && scanned >= limit) break;

    const { data, error } = await supabase
      .from("products")
      .select("id, slug, zepto_sku, image_urls, ocr_image_url")
      .not("image_urls", "is", null)
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    if (!rows.length) break;

    for (const row of rows) {
      if (limit != null && scanned >= limit) break;
      scanned++;

      const urls = (row.image_urls ?? []).filter(Boolean);
      if (urls.length < 2) continue;

      let nextUrls = normalizeProductImageUrls(urls, { ocrImageUrl: row.ocr_image_url });
      let source: "reorder" | "bff" = "reorder";

      const sku = row.zepto_sku?.trim() ?? "";
      if (
        refetchBff &&
        session &&
        isZeptoVariantId(sku) &&
        // For BFF mode, fetch EVERY multi-image product — Zepto's BFF returns the
        // canonical front-first order, which is the only signal that fixes "blind"
        // products (opaque UUID urls, no OCR label). The local needsHeroReorder
        // heuristic can't see those, so gating on it skips the exact cases we want.
        urls.length >= 2
      ) {
        try {
          const cached = imageCache.get(sku);
          const bff =
            cached?.length
              ? cached
              : await fetchVariantImagesFromBff(sku, session, bffHttp);
          if (bff.length) {
            imageCache.set(sku, bff);
            const bffNorm = normalizeProductImageUrls(bff, { ocrImageUrl: row.ocr_image_url });
            if (bffNorm.length && dedupeImageUrls(bffNorm)[0] !== dedupeImageUrls(urls)[0]) {
              nextUrls = bffNorm;
              source = "bff";
              refetched++;
            }
          }
        } catch (e) {
          console.warn(`[fix-images] BFF ${sku}: ${(e as Error).message.slice(0, 80)}`);
        }
      }

      const changed =
        nextUrls.length !== urls.length ||
        nextUrls.some((u, i) => u !== urls[i]);

      if (!changed) continue;
      flagged++;

      if (dryRun) {
        if (flagged <= 25) {
          console.log(
            `[fix-images] ${row.slug} (${source}) hero: ${urls[0]?.slice(-48)} → ${nextUrls[0]?.slice(-48)}`,
          );
        }
        continue;
      }

      if (!apply) continue;

      const { error: upErr } = await supabase
        .from("products")
        .update({ image_urls: nextUrls, updated_at: new Date().toISOString() })
        .eq("id", row.id);

      if (upErr) {
        console.warn(`[fix-images] update ${row.slug}: ${upErr.message}`);
      } else {
        updated++;
      }
    }

    offset += pageSize;
    if (rows.length < pageSize) break;
  }

  if (bffHttp) await closePlaywrightFetch();

  console.log(
    `[fix-images] scanned=${scanned} flagged=${flagged} updated=${updated} bff=${refetched} mode=${dryRun ? "dry-run" : "apply"}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
