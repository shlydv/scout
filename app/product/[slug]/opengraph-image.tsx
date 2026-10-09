import { ImageResponse } from "next/og";
import { getProductBySlug } from "@/lib/products/queries";
import { resolveProductVerdict } from "@/lib/scoring/verdict-resolve";
import { VERDICT_LABELS, type VerdictId } from "@/lib/scoring/verdict";

/**
 * Per-product share card (WhatsApp / X / iMessage previews): the verdict a
 * friend would want before buying. Literal colours — Satori can't read CSS vars.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Scout's verdict on this product";
export const revalidate = 86400;

const PAPER = "#faf7f2";
const INK = "#1c1612";
const MUTED = "#5e544b";
const DIM = "#8a7f74";
const VERDICT_COLOUR: Record<VerdictId, string> = {
  daily_staple: "#16a34a",
  good_choice: "#65a30d",
  occasional_treat: "#d97706",
  skip: "#dc2626",
};

async function serif(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch("https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap").then(r => r.text());
    const url = css.match(/src: url\((.+?)\) format/)?.[1];
    return url ? await fetch(url).then(r => r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, font] = await Promise.all([getProductBySlug(slug).catch(() => null), serif()]);
  const fonts = font ? [{ name: "Instrument Serif", data: font, style: "normal" as const }] : undefined;
  const display = font ? "Instrument Serif" : "serif";

  if (!product) {
    return new ImageResponse(
      <div style={{ display: "flex", width: "100%", height: "100%", background: PAPER, alignItems: "center", justifyContent: "center", fontFamily: display, fontSize: 64, color: INK }}>
        Scout — we read the back label
      </div>,
      { ...size, fonts },
    );
  }

  const cs = product.core_scores;
  const score = cs?.absolute_score ?? cs?.score ?? null;
  const verdict = cs ? resolveProductVerdict({ verdict: cs.verdict, score, name: product.name, category: product.category, subcategory: product.subcategory }) : null;
  const colour = verdict ? VERDICT_COLOUR[verdict] : DIM;
  const take = (cs?.opinion?.headline ?? (verdict ? VERDICT_LABELS[verdict].description : "Read before you buy.")).slice(0, 110);
  const image = product.image_urls?.[0];
  const name = product.name.length > 70 ? `${product.name.slice(0, 68)}…` : product.name;

  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: PAPER, padding: 56, gap: 52, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", width: 430, height: 518, background: "#ffffff", borderRadius: 36, alignItems: "center", justifyContent: "center", border: "2px solid rgba(60,40,20,0.10)" }}>
        {image ? <img src={image} alt="" width={360} height={360} style={{ objectFit: "contain" }} /> : <div style={{ display: "flex", fontSize: 28, color: DIM }}>No image</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {product.brand && <div style={{ display: "flex", fontSize: 24, letterSpacing: 4, textTransform: "uppercase", color: DIM }}>{product.brand}</div>}
          <div style={{ display: "flex", marginTop: 14, fontFamily: display, fontSize: 54, lineHeight: 1.05, color: INK }}>{name}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          {score != null && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 150, height: 150, borderRadius: 999, background: colour, color: "#ffffff" }}>
              <div style={{ display: "flex", fontSize: 68, fontWeight: 700, lineHeight: 1 }}>{score}</div>
              <div style={{ display: "flex", fontSize: 22, opacity: 0.9 }}>/100</div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            {verdict && <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: colour }}>{VERDICT_LABELS[verdict].title}</div>}
            <div style={{ display: "flex", marginTop: 8, fontSize: 28, lineHeight: 1.25, color: MUTED }}>{take}</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, color: DIM }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", width: 40, height: 40, borderRadius: 10, background: INK, color: PAPER, alignItems: "center", justifyContent: "center", fontFamily: display, fontSize: 26 }}>S</div>
            <div style={{ display: "flex", fontFamily: display, fontSize: 32, color: INK }}>Scout</div>
          </div>
          <div style={{ display: "flex" }}>We read the back label so you don&apos;t have to</div>
        </div>
      </div>
    </div>,
    { ...size, fonts },
  );
}
