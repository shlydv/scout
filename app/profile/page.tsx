"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { supabase as supabaseClient } from "@/lib/supabase/client";
import {
  deleteSavedSearch,
  listSavedSearches,
  runSearchAlerts,
  updateSavedSearch,
  type SavedSearchRow,
} from "@/lib/search/saved-searches";

type Identity = {
  provider: string;
  identity_data?: { email?: string; phone?: string };
};

export default function ProfilePage() {
  const { ready, session, profile, signInWithGoogle, signOut, refreshProfile } = useAuth();
  const router = useRouter();
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [linkingPhone, setLinkingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [linkStep, setLinkStep] = useState<"idle" | "phone" | "otp">("idle");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearchRow[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedBusyId, setSavedBusyId] = useState<string | null>(null);
  const [alertCheckStatus, setAlertCheckStatus] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<
    Array<{ id: string; query: string; new_matches: number; previous: number; created_at: string; read_at: string | null }>
  >([]);

  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  const loadSavedSearches = useCallback(async () => {
    if (!session) return;
    setSavedLoading(true);
    try {
      const rows = await listSavedSearches(session.access_token);
      setSavedSearches(rows);
    } catch { /* ignore */ }
    finally { setSavedLoading(false); }
  }, [session]);

  useEffect(() => { void loadSavedSearches(); }, [loadSavedSearches]);

  useEffect(() => {
    if (!session) return;
    void (async () => {
      try {
        const res = await fetch("/api/me/alert-notifications", {
          headers: { authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          notifications?: Array<{
            id: string;
            query: string;
            new_matches: number;
            previous: number;
            created_at: string;
            read_at: string | null;
          }>;
        };
        setNotifications(data.notifications ?? []);
      } catch { /* ignore */ }
    })();
  }, [session]);

  const markNotificationsRead = async () => {
    if (!session) return;
    const unread = notifications.filter((n) => !n.read_at).map((n) => n.id);
    if (!unread.length) return;
    try {
      await fetch("/api/me/alert-notifications", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ids: unread }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
      );
    } catch { /* ignore */ }
  };

  const toggleSavedAlert = async (row: SavedSearchRow) => {
    if (!session) return;
    setSavedBusyId(row.id);
    try {
      const updated = await updateSavedSearch(session.access_token, {
        id: row.id,
        alert_enabled: !row.alert_enabled,
      });
      setSavedSearches(prev => prev.map(s => (s.id === row.id ? updated : s)));
    } finally { setSavedBusyId(null); }
  };

  const removeSavedSearch = async (id: string) => {
    if (!session) return;
    setSavedBusyId(id);
    try {
      await deleteSavedSearch(session.access_token, id);
      setSavedSearches(prev => prev.filter(s => s.id !== id));
    } finally { setSavedBusyId(null); }
  };

  const checkAlertsNow = async () => {
    if (!session) return;
    setAlertCheckStatus("Checking…");
    try {
      const { triggered, error } = await runSearchAlerts(session.access_token);
      if (error) {
        setAlertCheckStatus(error.includes("SEARCH_V2") ? "Alerts need Search V2 enabled" : error);
      } else if (triggered.length === 0) {
        setAlertCheckStatus("No new matches since last check");
      } else {
        setAlertCheckStatus(
          `${triggered.length} alert${triggered.length === 1 ? "" : "s"} with new matches`,
        );
      }
      await loadSavedSearches();
    } catch {
      setAlertCheckStatus("Could not run alerts");
    }
  };

  // Load linked identities
  useEffect(() => {
    if (!session || !supabaseClient) return;
    supabaseClient.auth.getUserIdentities().then(({ data }) => {
      setIdentities((data?.identities ?? []) as Identity[]);
    });
  }, [session]);

  const handleLinkGoogle = async () => {
    if (!supabaseClient) return;
    setLinkError(null);
    await supabaseClient.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const handleSendLinkOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseClient) return;
    setLinkLoading(true);
    setLinkError(null);
    try {
      const phone = phoneInput.startsWith("+") ? phoneInput : `+91${phoneInput.replace(/\D/g, "")}`;
      const { error } = await supabaseClient.auth.signInWithOtp({ phone });
      if (error) throw error;
      setLinkStep("otp");
    } catch (e) { setLinkError((e as Error).message); }
    finally { setLinkLoading(false); }
  };

  const handleVerifyLinkOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseClient) return;
    setLinkLoading(true);
    setLinkError(null);
    try {
      const phone = phoneInput.startsWith("+") ? phoneInput : `+91${phoneInput.replace(/\D/g, "")}`;
      const { error } = await supabaseClient.auth.verifyOtp({ phone, token: otpInput, type: "sms" });
      if (error) throw error;
      setLinkStep("idle");
      setPhoneInput("");
      setOtpInput("");
      await refreshProfile();
    } catch (e) { setLinkError((e as Error).message); }
    finally { setLinkLoading(false); }
  };

  if (!ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-(--color-bg)">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-line) border-t-(--color-fg)" />
      </div>
    );
  }

  const email = profile?.email ?? session.user?.email ?? null;
  const phone = profile?.phone ?? session.user?.phone ?? null;
  const displayName = profile?.full_name ?? email?.split("@")[0] ?? phone ?? "Scout user";

  const hasGoogle = identities.some(i => i.provider === "google");
  const hasPhone = identities.some(i => i.provider === "phone");

  function formatDate(iso: string) {
    const d = new Date(iso);
    const diffMins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diffMins < -60 * 24) {
      return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    }
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  return (
    <main className="min-h-screen bg-(--color-bg)">
      <SiteNav />
      <div className="mx-auto max-w-5xl px-5 pb-24 pt-8 md:px-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-(--color-fg) font-display text-2xl text-(--color-bg)">
              {displayName[0]?.toUpperCase() ?? "?"}
            </div>
            <div>
              <h1 className="font-display text-2xl text-(--color-fg)">{displayName}</h1>
              <p className="mt-0.5 text-sm text-(--color-fg-muted)">
                {email ?? phone ?? "No contact linked"}
              </p>
            </div>
          </div>
          <span className="mt-1 text-xs text-(--color-fg-dim)">Free for everyone</span>
        </div>

        {/* Stats row */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {[
            {
              label: "AI searches",
              value: "∞",
              sub: "free, unlimited",
            },
            { label: "Saved searches", value: savedSearches.length, sub: "bookmarked" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-(--color-line) bg-(--color-panel) p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-(--color-fg-dim)">{s.label}</p>
              <p className="mt-1 font-display text-3xl text-(--color-fg)">{s.value}</p>
              <p className="mt-0.5 text-[11px] text-(--color-fg-dim)">{s.sub}</p>
            </div>
          ))}
        </div>

        {notifications.some((n) => !n.read_at) ? (
          <div className="mt-4 rounded-xl border border-(--color-accent)/30 bg-(--color-accent)/8 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-(--color-fg)">New alert matches</p>
                <ul className="mt-2 space-y-1">
                  {notifications
                    .filter((n) => !n.read_at)
                    .slice(0, 5)
                    .map((n) => (
                      <li key={n.id} className="text-[13px] text-(--color-fg-muted)">
                        <Link
                          href={`/search?prompt=${encodeURIComponent(n.query)}`}
                          className="font-medium text-(--color-fg) hover:text-(--color-accent)"
                        >
                          {n.query}
                        </Link>
                        {" — "}
                        {n.new_matches} matches (was {n.previous})
                      </li>
                    ))}
                </ul>
              </div>
              <button
                type="button"
                onClick={() => void markNotificationsRead()}
                className="flex-shrink-0 text-[12px] font-medium text-(--color-fg-muted) hover:text-(--color-fg)"
              >
                Mark read
              </button>
            </div>
          </div>
        ) : null}

        {/* Linked accounts */}
        <div className="mt-8">
          <h2 className="font-display text-xl text-(--color-fg)">Linked accounts</h2>
          <p className="mt-1 text-[13px] text-(--color-fg-muted)">Connect multiple sign-in methods to your account.</p>
          <div className="mt-4 space-y-2">
            {/* Google */}
            <div className="flex items-center justify-between rounded-xl border border-(--color-line) bg-(--color-panel) px-4 py-3">
              <div className="flex items-center gap-3">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M17.64 9.2c0-.637-.057-1.25-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
                  <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
                </svg>
                <div>
                  <p className="text-[13px] font-medium text-(--color-fg)">Google</p>
                  {hasGoogle && email ? <p className="text-[11px] text-(--color-fg-dim)">{email}</p> : null}
                </div>
              </div>
              {hasGoogle ? (
                <span className="text-[11px] font-medium text-(--color-good)">Connected</span>
              ) : (
                <button onClick={handleLinkGoogle} className="rounded-lg border border-(--color-line) px-3 py-1.5 text-[12px] font-medium text-(--color-fg-muted) transition hover:text-(--color-fg)">
                  Connect
                </button>
              )}
            </div>

            {/* Phone */}
            <div className="rounded-xl border border-(--color-line) bg-(--color-panel) px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-lg">📱</span>
                  <div>
                    <p className="text-[13px] font-medium text-(--color-fg)">Phone (OTP)</p>
                    {hasPhone && phone ? <p className="text-[11px] text-(--color-fg-dim)">{phone}</p> : null}
                  </div>
                </div>
                {hasPhone ? (
                <span className="text-[11px] font-medium text-(--color-good)">Connected</span>
                ) : linkStep === "idle" ? (
                  <button
                    onClick={() => setLinkStep("phone")}
                    className="rounded-lg border border-(--color-line) px-3 py-1.5 text-[12px] font-medium text-(--color-fg-muted) transition hover:text-(--color-fg)"
                  >
                    Connect
                  </button>
                ) : null}
              </div>
              {linkStep === "phone" ? (
                <form onSubmit={handleSendLinkOtp} className="mt-3 flex gap-2">
                  <div className="flex flex-1 overflow-hidden rounded-lg border border-(--color-line-strong)">
                    <span className="flex items-center border-r border-(--color-line) bg-(--color-bg-soft) px-2.5 text-xs text-(--color-fg-dim)">+91</span>
                    <input
                      type="tel" value={phoneInput} onChange={e => setPhoneInput(e.target.value)}
                      placeholder="98765 43210"
                      className="flex-1 bg-(--color-bg) px-2.5 py-2 text-sm text-(--color-fg) outline-none"
                      required
                    />
                  </div>
                  <button type="submit" disabled={linkLoading} className="rounded-lg bg-(--color-fg) px-3 py-2 text-xs font-semibold text-(--color-bg) disabled:opacity-50">
                    {linkLoading ? "…" : "Send"}
                  </button>
                  <button type="button" onClick={() => setLinkStep("idle")} className="text-xs text-(--color-fg-dim)">Cancel</button>
                </form>
              ) : linkStep === "otp" ? (
                <form onSubmit={handleVerifyLinkOtp} className="mt-3 flex gap-2">
                  <input
                    type="text" inputMode="numeric" maxLength={6}
                    value={otpInput} onChange={e => setOtpInput(e.target.value.replace(/\D/g, ""))}
                    placeholder="6-digit code"
                    className="flex-1 rounded-lg border border-(--color-line-strong) bg-(--color-bg) px-3 py-2 text-center text-sm tracking-widest text-(--color-fg) outline-none"
                    required
                  />
                  <button type="submit" disabled={linkLoading || otpInput.length < 6} className="rounded-lg bg-(--color-fg) px-3 py-2 text-xs font-semibold text-(--color-bg) disabled:opacity-50">
                    {linkLoading ? "…" : "Verify"}
                  </button>
                </form>
              ) : null}
              {linkError ? <p className="mt-2 text-[11px] text-(--color-bad)">{linkError}</p> : null}
            </div>
          </div>
        </div>

        {/* Saved searches */}
        <div className="mt-10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl text-(--color-fg)">Saved searches</h2>
              <p className="mt-1 text-[13px] text-(--color-fg-muted)">
                Re-run saved queries and get in-app alerts when new products match.
              </p>
            </div>
            {savedSearches.some(s => s.alert_enabled) ? (
              <button
                type="button"
                onClick={() => void checkAlertsNow()}
                className="flex-shrink-0 rounded-lg border border-(--color-line) px-3 py-1.5 text-[12px] font-medium text-(--color-fg-muted) transition hover:text-(--color-fg)"
              >
                Check alerts
              </button>
            ) : null}
          </div>
          {alertCheckStatus ? (
            <p className="mt-2 text-[12px] text-(--color-fg-dim)">{alertCheckStatus}</p>
          ) : null}
          {savedLoading ? (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-(--color-bg-soft)" />
              ))}
            </div>
          ) : savedSearches.length === 0 ? (
            <div className="mt-4 rounded-xl border border-(--color-line) bg-(--color-panel) py-8 text-center">
              <p className="text-sm text-(--color-fg-muted)">No saved searches yet.</p>
              <Link href="/search" className="mt-2 inline-block text-[13px] font-medium text-(--color-accent) hover:underline">
                Search and save a query →
              </Link>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-(--color-line) overflow-hidden rounded-xl border border-(--color-line) bg-(--color-panel)">
              {savedSearches.map(s => (
                <div key={s.id} className="group flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/search?prompt=${encodeURIComponent(s.query)}`}
                      className="block truncate text-[14px] font-medium text-(--color-fg) hover:text-(--color-accent)"
                    >
                      {s.label || s.query}
                    </Link>
                    {s.label && s.label !== s.query ? (
                      <p className="mt-0.5 truncate text-[11px] text-(--color-fg-dim)">{s.query}</p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] text-(--color-fg-dim)">
                      Saved {formatDate(s.created_at)}
                      {s.alert_enabled ? " · alerts on" : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={savedBusyId === s.id}
                    onClick={() => void toggleSavedAlert(s)}
                    title={s.alert_enabled ? "Turn off alerts" : "Alert me when new matches appear"}
                    className={`flex-shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                      s.alert_enabled
                        ? "border-(--color-warn)/40 bg-(--color-warn)/10 text-(--color-warn)"
                        : "border-(--color-line) text-(--color-fg-dim) hover:text-(--color-fg)"
                    }`}
                  >
                    {savedBusyId === s.id ? "…" : s.alert_enabled ? "Alerting" : "Alert"}
                  </button>
                  <button
                    type="button"
                    disabled={savedBusyId === s.id}
                    onClick={() => void removeSavedSearch(s.id)}
                    className="flex-shrink-0 opacity-0 transition group-hover:opacity-100 hover:!opacity-100 text-(--color-fg-dim)"
                    title="Remove"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M1 1l10 10M11 1 1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Danger zone */}
        <div className="mt-10 border-t border-(--color-line) pt-8">
          <button onClick={() => { void signOut().then(() => router.replace("/")); }}
            className="w-full rounded-xl border border-(--color-line) bg-(--color-panel) px-4 py-3 text-sm font-medium text-(--color-fg-muted) transition hover:border-(--color-fg-muted) hover:text-(--color-fg)">
            Sign out
          </button>
        </div>

      </div>
      <SiteFooter />
    </main>
  );
}
