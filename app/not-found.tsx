import Link from "@/components/navigation-link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="font-display text-6xl text-(--color-fg-muted)">404</h1>
      <p className="mt-4 text-(--color-fg-muted)">This page doesn&apos;t exist.</p>
      <Link
        href="/search"
        className="mt-6 inline-block rounded-xl bg-(--color-fg) px-6 py-2.5 text-sm font-medium text-(--color-bg)"
      >
        Search catalog
      </Link>
    </main>
  );
}
