"use client";

import type { AiSearchPreferences } from "@/lib/search/preferences";

export type SavedSearchRow = {
  id: string;
  label: string | null;
  query: string;
  preferences: AiSearchPreferences | Record<string, unknown>;
  alert_enabled: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

async function authHeaders(accessToken: string | undefined): Promise<HeadersInit> {
  if (!accessToken) throw new Error("Sign in to save searches");
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
  };
}

export async function saveSearch(
  accessToken: string | undefined,
  opts: { query: string; label?: string; preferences?: AiSearchPreferences | null; alert_enabled?: boolean },
): Promise<{ id: string }> {
  const res = await fetch("/api/me/saved-searches", {
    method: "POST",
    headers: await authHeaders(accessToken),
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { saved_search: { id: string } };
  return { id: data.saved_search.id };
}

export async function listSavedSearches(accessToken: string | undefined): Promise<SavedSearchRow[]> {
  if (!accessToken) return [];
  const res = await fetch("/api/me/saved-searches", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { saved_searches: SavedSearchRow[] };
  return data.saved_searches ?? [];
}

export async function deleteSavedSearch(accessToken: string | undefined, id: string): Promise<void> {
  const res = await fetch(`/api/me/saved-searches?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(accessToken),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
}

export async function updateSavedSearch(
  accessToken: string | undefined,
  opts: { id: string; alert_enabled?: boolean; label?: string },
): Promise<SavedSearchRow> {
  const res = await fetch("/api/me/saved-searches", {
    method: "PATCH",
    headers: await authHeaders(accessToken),
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { saved_search: SavedSearchRow };
  return data.saved_search;
}

export async function runSearchAlerts(accessToken: string | undefined): Promise<{
  triggered: Array<{ id: string; query: string; new_matches: number; previous?: number }>;
  error?: string;
}> {
  if (!accessToken) return { triggered: [], error: "Sign in required" };
  const res = await fetch("/api/me/search-alerts", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json().catch(() => null)) as {
    triggered?: Array<{ id: string; query: string; new_matches: number; previous?: number }>;
    error?: string;
  } | null;
  if (!res.ok) {
    return { triggered: [], error: body?.error ?? `HTTP ${res.status}` };
  }
  return { triggered: body?.triggered ?? [] };
}
