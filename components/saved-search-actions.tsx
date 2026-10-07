"use client";

import { Bell, Bookmark } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth/context";
import type { AiSearchPreferences } from "@/lib/search/ai-usage";
import { saveSearch } from "@/lib/search/v2/saved-searches-client";

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
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleSave(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-(--color-line) px-3 py-1.5 text-xs font-medium text-(--color-fg-muted) hover:border-(--color-fg-dim) hover:text-(--color-fg) disabled:opacity-50"
      >
        <Bell className="h-3.5 w-3.5" />
        Alert me
      </button>
      {status ? <span className="text-xs text-(--color-fg-dim)">{status}</span> : null}
    </div>
  );
}
