import Link from "@/components/navigation-link";

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="font-display text-2xl font-bold text-(--color-fg)">Admin</h1>
      <div className="mt-6 space-y-2">
        <Link
          href="/admin/image-tagger"
          className="flex items-center justify-between rounded-xl border border-(--color-line) px-5 py-3 text-sm font-medium text-(--color-fg) transition hover:border-(--color-fg-dim) hover:bg-(--color-bg-soft)"
        >
          Image Tagger
          <span className="text-(--color-fg-dim)">→</span>
        </Link>
        <Link
          href="/admin/needs-review"
          className="flex items-center justify-between rounded-xl border border-(--color-line) px-5 py-3 text-sm font-medium text-(--color-fg) transition hover:border-(--color-fg-dim) hover:bg-(--color-bg-soft)"
        >
          Needs Review
          <span className="text-(--color-fg-dim)">→</span>
        </Link>
      </div>
    </main>
  );
}
