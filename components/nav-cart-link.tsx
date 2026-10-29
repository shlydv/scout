"use client";

import Link from "@/components/navigation-link";
import { useEffect, useState } from "react";
import { basketCount } from "@/lib/basket/storage";

export function NavCartLink({ className }: { className?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(basketCount());
    sync();
    window.addEventListener("scout-basket", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("scout-basket", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <Link href="/basket" className={className}>
      Basket
      {count > 0 ? (
        <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-(--color-accent) px-1.5 text-[11px] font-semibold text-white tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
