import type { MetadataRoute } from "next";

// Crawlers that collect pages for AI training or AI answers and send no visitors back. Each crawl
// renders product pages on Vercel's metered CPU. Search crawlers (Googlebot, Bingbot, Applebot) and
// ChatGPT's search and user-fetch agents (OAI-SearchBot, ChatGPT-User), which link back, stay allowed.
const AI_CRAWLERS = [
  "meta-externalagent",
  "meta-webindexer",
  "GPTBot",
  "ClaudeBot",
  "CCBot",
  "Bytespider",
  "Amazonbot",
];

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // A product URL with a query string (?q=, ?goal=, ?context=…) renders per request and is the
        // same product as the plain URL, which carries the canonical link.
        disallow: ["/api/", "/admin/", "/profile", "/basket", "/auth/", "/product/*?"],
      },
      { userAgent: AI_CRAWLERS, disallow: "/" },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
