"use client";

import { Bell, Bookmark } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth/context";
import type { AiSearchPreferences } from "@/lib/search/preferences";
import { saveSearch } from "@/lib/search/saved-searches";

const ALERTS_ENABLED = process.env.NEXT_PUBLIC_SEARCH_ALERTS === "1";

export function SavedSearchActions({
  query,
  preferences,
}: {
  query: string;
  preferences?: AiSearchPreferences | null;
}) {
  const auth = useAuth();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!query.trim()) return null;

  async function handleSave(alert: boolean) {
    if (!auth?.session?.access_token) {
      setStatus("Sign in to save searches");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await saveSearch(auth.session.access_token, {
        query,
        preferences,
        alert_enabled: alert,
      });
      setStatus(alert ? "Saved with alerts on" : "Search saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save";
      setStatus(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleSave(false)}
        className="inline-flex items-center gap-1.5 rounded-full border border-(--color-line) px-3 py-1.5 text-xs font-medium text-(--color-fg-muted) hover:border-(--color-fg-dim) hover:text-(--color-fg) disabled:opacity-50"
      >
        <Bookmark className="h-3.5 w-3.5" />
        Save search
      </button>
      {/* Alert emails need RESEND_API_KEY on the server; don't offer what can't be delivered. */}
      {ALERTS_ENABLED ? <button
        type="button"
        disabled={busy}
        onClick={() => void handleSave(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-(--color-line) px-3 py-1.5 text-xs font-medium text-(--color-fg-muted) hover:border-(--color-fg-dim) hover:text-(--color-fg) disabled:opacity-50"
      >
        <Bell className="h-3.5 w-3.5" />
        Alert me
      </button> : null}
      {status ? <span className="text-xs text-(--color-fg-dim)">{status}</span> : null}
    </div>
  );
}
