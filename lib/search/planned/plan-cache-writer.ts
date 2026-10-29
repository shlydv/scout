/** Server-side cache persistence uses the existing service credential, never PG write grants. */
import type { SearchPlan } from "./plan";
import { createDeadline, throwIfAborted } from "./runtime";

export type SharedPlanRecord = { cache_key: string; plan: SearchPlan; dropped: string[] };
type WriterOptions = {
  config: () => { url: string; key: string } | null;
  fetch: typeof globalThis.fetch;
  warn: (message: string) => void;
  timeoutMs?: number;
};

/** A narrow transport with no retry/backoff; cache failure cannot stall search. */
export function createSharedPlanWriter(options: WriterOptions) {
  let warned = false;
  const localOnly = (reason: string) => {
    if (warned) return;
    warned = true;
    options.warn(`[search-plan-cache] shared persistence unavailable (${reason}); using process-local cache`);
  };
  return async (record: SharedPlanRecord, signal?: AbortSignal): Promise<void> => {
    throwIfAborted(signal);
    const config = options.config();
    if (!config) { localOnly("configuration missing"); return; }
    const deadline = createDeadline(options.timeoutMs ?? 2000, signal);
    try {
      const url = new URL(config.url.trim().replace(/\/rest\/v1\/?$/i, ""));
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("invalid cache URL");
      url.pathname = "/rest/v1/search_plan_cache";
      url.search = "?on_conflict=cache_key";
      url.hash = "";
      const response = await options.fetch(url, {
        method: "POST",
        headers: {
          apikey: config.key,
          authorization: `Bearer ${config.key}`,
          "content-type": "application/json",
          prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({ ...record, created_at: new Date().toISOString(), hits: 0 }),
        signal: deadline.signal,
        cache: "no-store",
        redirect: "error",
      });
      // return=minimal needs no payload; release the connection on errors too.
      await response.body?.cancel();
      if (!response.ok) localOnly(`HTTP ${response.status}`);
    } catch {
      // Request cancellation is expected. Never log URLs, keys, plan contents,
      // or raw transport errors, which can include sensitive request details.
      if (!signal?.aborted) localOnly(deadline.signal.aborted ? "write deadline exceeded" : "transport failure");
    } finally {
      deadline.dispose();
    }
  };
}

export const writeSharedPlan = createSharedPlanWriter({
  config: () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    return url && key ? { url, key } : null;
  },
  fetch: (...args) => globalThis.fetch(...args),
  warn: message => console.warn(message),
});
