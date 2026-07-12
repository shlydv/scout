"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth/context";

type AdminApi = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
};

const AdminApiContext = createContext<AdminApi | null>(null);

export function useAdminApi(): AdminApi {
  const ctx = useContext(AdminApiContext);
  if (!ctx) throw new Error("useAdminApi must be used inside AdminShell");
  return ctx;
}

/** Gates /admin/* behind a signed-in session; APIs enforce ADMIN_EMAILS server-side. */
export function AdminShell({ children }: { children: ReactNode }) {
  const { ready, session, signInWithGoogle } = useAuth();

  const api = useMemo<AdminApi | null>(() => {
    if (!session?.access_token) return null;
    const token = session.access_token;
    return {
      fetch: (input: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set("authorization", `Bearer ${token}`);
        if (init?.body && !headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }
        return fetch(input, { ...init, headers });
      },
    };
  }, [session?.access_token]);

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-(--color-bg)">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-line) border-t-(--color-fg)" />
      </main>
    );
  }

  if (!session || !api) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-display text-2xl text-(--color-fg)">Admin</h1>
        <p className="text-sm text-(--color-fg-muted)">
          Sign in with an admin account to continue.
        </p>
        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          className="rounded-xl bg-(--color-fg) px-5 py-2.5 text-sm font-semibold text-(--color-bg)"
        >
          Sign in with Google
        </button>
        <Link href="/" className="text-xs text-(--color-fg-dim) hover:underline">
          Back to Scout
        </Link>
      </main>
    );
  }

  return (
    <AdminApiContext.Provider value={api}>
      {children}
    </AdminApiContext.Provider>
  );
}

/** Optional: probe admin access once and surface a clear 401. */
export function useAdminGateMessage() {
  const api = useAdminApi();
  return useCallback(async () => {
    const res = await api.fetch("/api/admin/reorder-images?count=1");
    if (res.status === 401 || res.status === 503) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return data.error ?? "Unauthorized";
    }
    return null;
  }, [api]);
}
