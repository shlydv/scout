/**
 * Catalog hero image selection — Zepto CDN URLs are opaque UUIDs, so URL heuristics
 * barely help. When `ocr_image_url` is set we know which frame is the back label
 * (usually middle of the array). Hero = a non-label frame; label moves to the end.
 */

const LABEL_URL_RE =
  /\b(nutrition(?:al)?|nfp|ingredient|composition|back[-_]?label|back[-_]?of|rear|facts|fssai|statutory|regulatory|barcode|qr[-_]?code|mrp[-_]?sticker|label[-_]?shot)\b/i;

const HERO_URL_RE =
  /\b(front[-_]?(?:of[-_]?pack|pack|shot|view)?|pack[-_]?shot|hero|main[-_]?image|primary[-_]?image|thumbnail|thumb|cover|lifestyle|product[-_]?shot)\b/i;

/** Strip query/hash so width variants dedupe. */
export function imageUrlKey(url: string): string {
  const s = url.trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return s.split("?")[0]?.split("#")[0]?.toLowerCase() ?? s.toLowerCase();
  }
}

function uuidFromUrl(url: string): string | null {
  const m = url.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return m?.[0]?.toLowerCase() ?? null;
}

/** Same asset may appear with different CDN path prefixes or query widths. */
export function urlsMatchImage(a: string, b: string): boolean {
  if (imageUrlKey(a) === imageUrlKey(b)) return true;
  const ua = uuidFromUrl(a);
  const ub = uuidFromUrl(b);
  return Boolean(ua && ub && ua === ub);
}

export function looksLikeLabelImageUrl(url: string): boolean {
  const key = imageUrlKey(url);
  if (!key) return false;
  if (LABEL_URL_RE.test(key)) return true;
  if (/\/(back|rear|label|nutrition|nfp)\//i.test(key)) return true;
  return false;
}

export function looksLikeHeroImageUrl(url: string): boolean {
  const key = imageUrlKey(url);
  if (!key) return false;
  if (looksLikeLabelImageUrl(url)) return false;
  if (HERO_URL_RE.test(key)) return true;
  if (/\/(front|hero|main|primary|thumbnail|thumb)\//i.test(key)) return true;
  return false;
}

/** Weak tie-break when OCR has not run — opaque Zepto URLs only. */
export function scoreHeroCandidate(url: string, index: number, total: number): number {
  let score = 0;
  if (looksLikeHeroImageUrl(url)) score += 12;
  if (looksLikeLabelImageUrl(url)) score -= 14;
  if (index === 0) score += 1;
  if (total > 1 && index === total - 1) score -= 3;
  return score;
}

export function dedupeImageUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw?.trim();
    if (!url) continue;
    const key = imageUrlKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export type OrderCatalogImagesOpts = {
  ocrImageUrl?: string | null;
  ocrPayload?: Record<string, unknown> | null;
};

function labelIndexFromOcrPayload(
  payload: Record<string, unknown> | null | undefined,
  urls: string[],
): number | null {
  if (!payload || !urls.length) return null;

  const direct = payload.image_index;
  if (typeof direct === "number" && direct >= 0 && direct < urls.length) {
    return direct;
  }

  const attempts = payload.attempts;
  if (Array.isArray(attempts)) {
    for (const item of attempts) {
      if (!item || typeof item !== "object") continue;
      const url = (item as { url?: string }).url;
      if (!url) continue;
      for (let i = 0; i < urls.length; i++) {
        if (urlsMatchImage(urls[i]!, url)) return i;
      }
    }
  }

  return null;
}

/** Index of the back-label frame we OCR'd (often middle of the gallery). */
export function resolveLabelImageIndex(
  urls: string[],
  opts: OrderCatalogImagesOpts = {},
): number | null {
  if (!urls.length) return null;

  const fromPayload = labelIndexFromOcrPayload(opts.ocrPayload, urls);
  if (fromPayload != null) return fromPayload;

  const ocr = opts.ocrImageUrl?.trim();
  if (!ocr) return null;

  for (let i = 0; i < urls.length; i++) {
    if (urlsMatchImage(urls[i]!, ocr)) return i;
  }
  return null;
}

/**
 * Pick front-of-pack among frames that are not the OCR label.
 * When label sits in the middle, listing order is often [misc, label, front].
 */
export function pickHeroIndex(urls: string[], labelIdx: number | null): number {
  if (urls.length <= 1) return 0;

  if (labelIdx == null) {
    let best = 0;
    let bestScore = scoreHeroCandidate(urls[0]!, 0, urls.length);
    for (let i = 1; i < urls.length; i++) {
      const s = scoreHeroCandidate(urls[i]!, i, urls.length);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    return best;
  }

  const nonLabel = urls.map((_, i) => i).filter((i) => i !== labelIdx);
  if (!nonLabel.length) return 0;

  if (labelIdx === 0) {
    return nonLabel.find((i) => i > 0) ?? nonLabel[0]!;
  }

  const before = nonLabel.filter((i) => i < labelIdx);
  const after = nonLabel.filter((i) => i > labelIdx);

  // Label in the middle: prefer the frame after the label (common listing order).
  if (labelIdx > 0 && labelIdx < urls.length - 1 && after.length) {
    return after[0]!;
  }

  if (before.length) return before[0]!;
  if (after.length) return after[0]!;
  return nonLabel[0]!;
}

function buildCatalogOrder(urls: string[], labelIdx: number | null, heroIdx: number): string[] {
  const hero = urls[heroIdx]!;
  const out: string[] = [hero];
  for (let i = 0; i < urls.length; i++) {
    if (i === heroIdx) continue;
    if (labelIdx != null && i === labelIdx) continue;
    out.push(urls[i]!);
  }
  if (labelIdx != null && labelIdx !== heroIdx) {
    out.push(urls[labelIdx]!);
  }
  return dedupeImageUrls(out);
}

/**
 * Reorder: hero first, other pack shots in original order, OCR label last.
 * When the product has been tagged by a human (ocr_image_url is set), the
 * tagger already placed the hero at index 0 — respect that order as-is.
 */
export function orderCatalogImageUrls(
  urls: string[],
  opts: OrderCatalogImagesOpts = {},
): string[] {
  const deduped = dedupeImageUrls(urls);
  if (deduped.length <= 1) return deduped;

  // When already tagged, the user explicitly chose the hero. The tagger
  // moved it to position 0. Don't second-guess with auto-hero heuristics.
  if (opts.ocrImageUrl?.trim()) {
    return deduped;
  }

  const labelIdx = resolveLabelImageIndex(deduped, opts);
  const heroIdx = pickHeroIndex(deduped, labelIdx);
  return buildCatalogOrder(deduped, labelIdx, heroIdx);
}

/** True when reordering would change the hero (index 0). */
export function needsHeroReorder(urls: string[], opts: OrderCatalogImagesOpts = {}): boolean {
  const deduped = dedupeImageUrls(urls);
  if (deduped.length <= 1) return false;
  const ordered = orderCatalogImageUrls(deduped, opts);
  return ordered[0] !== deduped[0];
}

export function normalizeProductImageUrls(
  urls: string[] | null | undefined,
  opts: OrderCatalogImagesOpts = {},
): string[] {
  if (!urls?.length) return [];
  return orderCatalogImageUrls(urls, opts);
}
