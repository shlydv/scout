"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavCartLink } from "@/components/nav-cart-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth/context";

function NavAuthButton() {
  const { ready, session, profile } = useAuth();
  if (!ready) return null;

  if (session && profile) {
    const initials = (profile.full_name ?? profile.email ?? "?")
      .split(" ")
      .map((w) => w[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("");
    return (
      <Link
        href="/profile"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-(--color-fg) text-[12px] font-semibold text-(--color-bg) transition hover:opacity-80"
        title={profile.email ?? "Profile"}
      >
        {initials || "?"}
      </Link>
    );
  }

  return (
    <Link
      href="/login"
      className="rounded-lg border border-(--color-line) px-3 py-1.5 text-[13px] font-medium text-(--color-fg-muted) transition hover:border-(--color-fg-muted) hover:text-(--color-fg)"
    >
      Sign in
    </Link>
  );
}

const LINKS = [
  { href: "/search", label: "Search" },
  { href: "/shelves", label: "Shelves" },
  { href: "/catalog", label: "Aisles" },
  { href: "/insights", label: "Insights" },
];

function NavLink({ href, label, className }: { href: string; label: string; className: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`${className} ${active ? "text-(--color-fg)" : ""}`}>
      {label}
    </Link>
  );
}

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-(--color-line) bg-(--color-panel)/90 backdrop-blur-md">
      <nav className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-(--color-fg) font-display text-base text-(--color-bg)">
            S
          </span>
          <span className="font-display text-lg text-(--color-fg)">Scout</span>
        </Link>
        <div className="hidden items-center gap-6 text-sm text-(--color-fg-muted) md:flex">
          {LINKS.map(l => <NavLink key={l.href} {...l} className="hover:text-(--color-fg)" />)}
          <NavCartLink className="inline-flex items-center hover:text-(--color-fg)" />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <NavAuthButton />
        </div>
      </nav>
      {/* Phones: the same links as a scrollable row (previously there was no navigation at all). */}
      <div className="flex gap-5 overflow-x-auto border-t border-(--color-line) px-4 py-2 text-[13px] text-(--color-fg-muted) md:hidden">
        {LINKS.map(l => <NavLink key={l.href} {...l} className="shrink-0 hover:text-(--color-fg)" />)}
        <NavCartLink className="inline-flex shrink-0 items-center hover:text-(--color-fg)" />
      </div>
    </header>
  );
}
