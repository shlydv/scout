import crypto from "node:crypto";

/**
 * Anonymous search gate — a signed counter cookie.
 *
 * The in-memory IP map alone resets on every serverless cold start and is not
 * shared across instances, so under a traffic spike anons would get well past
 * the free quota and the sign-in conversion gate would never fire. The cookie
 * travels with the visitor instead: HMAC-signed so it can't be forged, no DB
 * round-trip, no new infra. Clearing cookies resets it — acceptable friction;
 * the IP map stays as a second signal for exactly that case.
 */

export const ANON_FREE_SEARCHES = 3;
export const ANON_COOKIE_NAME = "scout_ag";
export const ANON_WINDOW_MS = 3_600_000; // 1 hour

function secret(): string {
  // Optional dedicated secret; falls back to a hash of the service-role key so
  // no new env var is required (never the key itself).
  return (
    process.env.ANON_GATE_SECRET ||
    crypto
      .createHash("sha256")
      .update(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "scout-anon-gate")
      .digest("hex")
  );
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 24);
}

export type AnonWindow = { start: number; count: number };

/** Parse + verify the signed cookie; returns a fresh window when absent, forged, or expired. */
export function readAnonWindow(cookieValue: string | undefined, now = Date.now()): AnonWindow {
  if (cookieValue) {
    const [startStr, countStr, sig] = cookieValue.split(".");
    if (startStr && countStr && sig) {
      const expected = sign(`${startStr}.${countStr}`);
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        const start = Number(startStr);
        const count = Number(countStr);
        if (Number.isFinite(start) && Number.isFinite(count) && now - start < ANON_WINDOW_MS) {
          return { start, count: Math.max(0, Math.floor(count)) };
        }
      }
    }
  }
  return { start: now, count: 0 };
}

export function anonCookieValue(w: AnonWindow): string {
  const payload = `${w.start}.${w.count}`;
  return `${payload}.${sign(payload)}`;
}
