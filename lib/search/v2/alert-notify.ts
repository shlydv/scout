import { adminClient } from "@/lib/supabase/admin";
import type { AlertTrigger } from "@/lib/search/v2/alert-runner";

/**
 * Persist in-app alert hits (+ optional email via Resend).
 * Best-effort: never throw — cron must keep sweeping other alerts.
 */
export async function deliverAlertTriggers(triggers: AlertTrigger[]): Promise<void> {
  if (!triggers.length) return;
  const supabase = adminClient();

  const rows = triggers.map((t) => ({
    user_id: t.user_id,
    alert_id: t.id,
    query: t.query,
    new_matches: t.new_matches,
    previous: t.previous,
  }));

  try {
    const { error } = await supabase.from("alert_notifications").insert(rows);
    if (error) {
      console.error("[alerts] notification insert failed:", error.message);
    }
  } catch (e) {
    console.error(
      "[alerts] notification insert failed:",
      e instanceof Error ? e.message : e,
    );
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const from = process.env.RESEND_FROM ?? "Scout <alerts@scout.app>";
  const site =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "https://oasis-phi-one.vercel.app";

  const userIds = [...new Set(triggers.map((t) => t.user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", userIds);

  const emailByUser = new Map(
    (profiles ?? [])
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
          subject: `New matches for “${t.query.slice(0, 60)}”`,
          text: [
            `Scout found ${t.new_matches} matches for “${t.query}” (was ${t.previous}).`,
            ``,
            `Open your saved search: ${site}/search?prompt=${encodeURIComponent(t.query)}`,
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
