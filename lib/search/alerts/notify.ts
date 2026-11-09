import { searchSql } from "@/lib/search/planned/db";
import type { AlertTrigger } from "@/lib/search/alerts/runner";

/**
 * Email alert hits via Resend (optional). The in-app notification is already committed
 * with the alert's state, so this is best-effort and never throws.
 */
export async function emailAlertTriggers(triggers: AlertTrigger[]): Promise<void> {
  if (!triggers.length) return;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const from = process.env.RESEND_FROM ?? "Scout <alerts@scout.app>";
  const site =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "https://oasis-phi-one.vercel.app";

  const userIds = [...new Set(triggers.map((t) => t.user_id))];
  let profiles: { id: string; email: string | null }[] = [];
  try {
    profiles = await searchSql()<{ id: string; email: string | null }[]>`
      select id, email from public.profiles where id = any(${userIds}::uuid[])`;
  } catch (e) {
    console.error("[alerts] email lookup failed:", e instanceof Error ? e.message : e);
    return;
  }

  const emailByUser = new Map(
    profiles
      .filter((p): p is { id: string; email: string } => Boolean(p.email))
      .map((p) => [p.id, p.email]),
  );

  for (const t of triggers) {
    const email = emailByUser.get(t.user_id);
    if (!email) continue;
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${resendKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: `New products for “${t.query.slice(0, 60)}”`,
          text: [
            `Scout found ${t.new_matches} new ${t.new_matches === 1 ? "product" : "products"} for “${t.query}”.`,
            ``,
            `Open your saved search: ${site}/search?q=${encodeURIComponent(t.query)}`,
            `Manage alerts: ${site}/profile`,
          ].join("\n"),
        }),
      });
    } catch (e) {
      console.error(
        "[alerts] email failed:",
        t.user_id,
        e instanceof Error ? e.message : e,
      );
    }
  }
}
