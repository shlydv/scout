import { NextRequest, NextResponse } from "next/server";
import { rejectUnlessAdmin } from "@/lib/auth/admin-gate";
import { adminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  image_urls: string[] | null;
  ocr_image_url: string | null;
};

let cachedCounts: { done: number; total: number; at: number } | null = null;
const COUNTS_TTL_MS = 60_000;

async function getCounts(supabase: ReturnType<typeof adminClient>) {
  if (cachedCounts && Date.now() - cachedCounts.at < COUNTS_TTL_MS) {
    return { done: cachedCounts.done, total: cachedCounts.total };
  }
  const [totalR, doneR] = await Promise.all([
    supabase.from("products").select("*", { count: "exact", head: true }).eq("platform", "zepto"),
    supabase.from("products").select("*", { count: "exact", head: true }).eq("platform", "zepto").not("ocr_image_url", "is", null),
  ]);
  cachedCounts = { done: doneR.count ?? 0, total: totalR.count ?? 0, at: Date.now() };
  return { done: cachedCounts.done, total: cachedCounts.total };
}

function clearCountCache() {
  cachedCounts = null;
}

function productShape(p: ProductRow, includeStatus = false) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    images: (p.image_urls ?? []).filter(Boolean),
    ...(includeStatus ? {
      ocr_status: p.ocr_image_url
        ? (p.ocr_image_url === "REVIEWED" ? "skipped" : "tagged")
        : "untagged",
    } : {}),
  };
}

export async function GET(req: NextRequest) {
  const denied = await rejectUnlessAdmin(req);
  if (denied) return denied;
  const supabase = adminClient();
  const skipId = req.nextUrl.searchParams.get("skip")?.trim() ?? null;
  const selectedId = req.nextUrl.searchParams.get("selected")?.trim() ?? null;
  const count = Number(req.nextUrl.searchParams.get("count") ?? 1) || 1;
  const search = req.nextUrl.searchParams.get("search")?.trim() ?? null;

  const { done, total } = await getCounts(supabase);

  // ── Search mode: direct product lookup (returns ALL images, includes tagged) ──
  if (search) {
    const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      return NextResponse.json({ done, total, products: [] });
    }
    let q = supabase
      .from("products")
      .select("id, slug, name, brand, image_urls, ocr_image_url")
      .eq("platform", "zepto")
      .not("image_urls", "is", null)
      .limit(500);

    // Match ALL tokens against name OR brand (AND semantics)
    for (const t of tokens) {
      q = q.or(`name.ilike.%${t}%,brand.ilike.%${t}%`);
    }

    const { data: rows, error } = await q;
    if (error || !rows?.length) {
      return NextResponse.json({ done, total, products: [] });
    }
    return NextResponse.json({
      done, total,
      products: (rows as ProductRow[]).map((p) => productShape(p, true)),
    });
  }

  if (selectedId) {
    const { data: row } = await supabase
      .from("products")
      .select("id, slug, name, brand, image_urls, ocr_image_url")
      .eq("id", selectedId)
      .maybeSingle();
    return NextResponse.json({
      done, total,
      products: row ? [productShape(row as ProductRow)] : [],
    });
  }

  // For batch mode, fetch enough rows to find 'count' multi-image products
  const needed = count * 12;
  const randomSkip = Math.floor(Math.random() * 5000);

  const { data, error } = await supabase
    .from("products")
    .select("id, slug, name, brand, image_urls, ocr_image_url")
    .eq("platform", "zepto")
    .is("ocr_image_url", null)
    .not("image_urls", "is", null)
    .range(randomSkip, randomSkip + needed - 1);

  if (error || !data?.length) {
    return NextResponse.json({ done, total, products: [] });
  }

  // Filter multi-image, shuffle, pick first 'count' not matching skipId
  const multi = (data as ProductRow[]).filter(
    (r) =>
      (!skipId || r.id !== skipId) &&
      (r.image_urls ?? []).filter(Boolean).length >= 2,
  );
  const shuffled = [...multi].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  return NextResponse.json({
    done,
    total,
    products: selected.map((p) => productShape(p)),
  });
}

export async function POST(req: NextRequest) {
  const denied = await rejectUnlessAdmin(req);
  if (denied) return denied;
  const body = (await req.json()) as {
    product_id?: string;
    hero_url?: string;
    reorder?: boolean;
    skip?: boolean;
    actions?: Array<{
      productId: string;
      heroUrl?: string;
      reorder?: boolean;
      skip?: boolean;
    }>;
  };

  const supabase = adminClient();

  // Batch mode
  if (body.actions?.length) {
    const results: Array<{ productId: string; ok: boolean; error?: string }> = [];
    for (const action of body.actions) {
      try {
        if (action.skip) {
          const { error: upErr } = await supabase
            .from("products")
            .update({ ocr_image_url: "REVIEWED", updated_at: new Date().toISOString() })
            .eq("id", action.productId);
          results.push({ productId: action.productId, ok: !upErr, error: upErr?.message });
        } else if (action.heroUrl) {
          const { data: row } = await supabase
            .from("products")
            .select("id, image_urls")
            .eq("id", action.productId)
            .maybeSingle();
          const urls = ((row as { image_urls: string[] | null } | null)?.image_urls ?? []).filter(Boolean);
          const updates: Record<string, unknown> = {
            ocr_image_url: action.heroUrl,
            updated_at: new Date().toISOString(),
          };
          if (action.reorder) {
            updates.image_urls = [action.heroUrl, ...urls.filter((u: string) => u !== action.heroUrl)];
          }
          const { error: upErr } = await supabase
            .from("products")
            .update(updates)
            .eq("id", action.productId);
          results.push({ productId: action.productId, ok: !upErr, error: upErr?.message });
        }
      } catch (e) {
        results.push({ productId: action.productId, ok: false, error: (e as Error).message });
      }
    }
    clearCountCache();
    const failures = results.filter(r => !r.ok);
    if (failures.length > 0) {
      console.error("[reorder-images] failures:", JSON.stringify(failures.slice(0, 5)));
    }
    return NextResponse.json({ ok: failures.length === 0, results, failed: failures.length });
  }

  // Single mode (backward compat)
  if (!body.product_id) {
    return NextResponse.json({ error: "product_id required" }, { status: 400 });
  }

  if (body.skip) {
    const { error: upErr } = await supabase
      .from("products")
      .update({ ocr_image_url: "REVIEWED", updated_at: new Date().toISOString() })
      .eq("id", body.product_id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    clearCountCache();
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (!body.hero_url) {
    return NextResponse.json({ error: "hero_url required" }, { status: 400 });
  }

  const { data: row } = await supabase
    .from("products")
    .select("id, image_urls")
    .eq("id", body.product_id)
    .maybeSingle();

  const currentUrls = ((row as { image_urls: string[] | null } | null)?.image_urls ?? []).filter(Boolean);

  const updates: Record<string, unknown> = {
    ocr_image_url: body.hero_url,
    updated_at: new Date().toISOString(),
  };
  let oldUrls: string[] | null = null;
  if (body.reorder) {
    oldUrls = [...currentUrls];
    updates.image_urls = [body.hero_url, ...currentUrls.filter((u) => u !== body.hero_url)];
  }

  const { error: upErr } = await supabase.from("products").update(updates).eq("id", body.product_id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  clearCountCache();
  return NextResponse.json({ ok: true, product_id: body.product_id, old_image_urls: oldUrls });
}

export async function PUT(req: NextRequest) {
  const denied = await rejectUnlessAdmin(req);
  if (denied) return denied;
  const body = (await req.json()) as { product_id?: string; restore_urls?: string[] };
  if (!body.product_id) return NextResponse.json({ error: "product_id required" }, { status: 400 });

  const supabase = adminClient();
  const updates: Record<string, unknown> = { ocr_image_url: null, updated_at: new Date().toISOString() };
  if (body.restore_urls?.length) updates.image_urls = body.restore_urls;

  const { error } = await supabase.from("products").update(updates).eq("id", body.product_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  clearCountCache();
  return NextResponse.json({ ok: true, undone: true, product_id: body.product_id });
}
