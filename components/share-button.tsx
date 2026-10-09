"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

/** Share the verdict — native share sheet on mobile, copy-link on desktop. */
export function ShareButton({ title, text }: { title: string; text?: string }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        /* user dismissed the sheet — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — nothing sane to do */
    }
  };

  const whatsapp = () => {
    const url = window.location.href.split("?")[0];
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text ?? title}\n${url}`)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <span className="inline-flex items-center gap-2">
    <button
      type="button"
      onClick={whatsapp}
      className="inline-flex items-center gap-1.5 rounded-lg border border-(--color-line) bg-(--color-panel) px-3 py-2 text-sm font-medium text-(--color-fg) hover:border-(--color-fg)"
      aria-label="Share on WhatsApp"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.2.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z" /></svg>
      WhatsApp
    </button>
    <button
      type="button"
      onClick={share}
      className="inline-flex items-center gap-1.5 rounded-lg border border-(--color-line) bg-(--color-panel) px-3 py-2 text-sm font-medium text-(--color-fg) hover:border-(--color-fg)"
    >
      {copied ? <Check className="h-4 w-4 text-(--color-good)" /> : <Share2 className="h-4 w-4" />}
      {copied ? "Link copied" : "Share"}
    </button>
    </span>
  );
}
