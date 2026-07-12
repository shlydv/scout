import { NextRequest, NextResponse } from "next/server";
import { supabaseFromBearer } from "@/lib/auth/supabase-user";

/** Shared secret for admin APIs, cron, and revalidate (ADMIN_SECRET preferred). */
export function adminSecret(): string | null {
  return process.env.ADMIN_SECRET || process.env.CRON_SECRET || null;
}

/** Emails allowed to use /admin UI + /api/admin/* with a user session. */
export function adminEmails(): Set<string> {
  const fromAdmin = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const fromUnlimited = (process.env.UNLIMITED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...fromAdmin, ...fromUnlimited]);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(email.trim().toLowerCase());
}

function bearerMatchesSecret(authHeader: string | null, secret: string): boolean {
  return Boolean(authHeader?.startsWith("Bearer ") && authHeader.slice(7).trim() === secret);
}

/**
 * Admin API gate: Bearer ADMIN_SECRET/CRON_SECRET, or signed-in admin email.
 * Returns null when authorized; otherwise a 401/503 response.
 */
export async function rejectUnlessAdmin(
  req: NextRequest | Request,
): Promise<NextResponse | null> {
  const secret = adminSecret();
  const auth = req.headers.get("authorization");

  if (secret && bearerMatchesSecret(auth, secret)) return null;

  const client = supabaseFromBearer(auth);
  if (client) {
    const { data, error } = await client.auth.getUser();
    if (!error && data.user && isAdminEmail(data.user.email)) return null;
  }

  if (!secret && adminEmails().size === 0) {
    return NextResponse.json(
      { error: "Admin access is not configured (set ADMIN_SECRET or ADMIN_EMAILS)." },
      { status: 503 },
    );
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Revalidate / cron-style secret: Bearer or ?secret= */
export function authorizeDeploySecret(req: NextRequest): boolean {
  const secret = adminSecret();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (bearerMatchesSecret(auth, secret)) return true;
  const q = req.nextUrl.searchParams.get("secret");
  return q === secret;
}
