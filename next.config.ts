import type { NextConfig } from "next";
import { PRODUCT_LIVE_QUERY_KEYS } from "./lib/products/live-query";

const nextConfig: NextConfig = {
  // /shelves waits for all twelve shelves; on a cold cache that is twelve planned searches,
  // which can pass the default 60 s and fail the build.
  staticPageGenerationTimeout: 180,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
  async redirects() {
    // Search lives on the home page now (/?q=). Old search URLs: ?prompt= (AI search) became ?q=;
    // catalog filters moved to /catalog. Query strings are passed through to the destination.
    const catalogKeys = ["category", "subcategory", "usecase", "brand", "grade", "verdict", "sublabel", "sort", "maxprice", "min", "goal", "diet", "slugs"];
    return [
      { source: "/blog", destination: "/", permanent: true },
      {
        source: "/search",
        has: [{ type: "query", key: "prompt", value: "(?<prompt>.+)" }],
        missing: [{ type: "query", key: "q" }],
        destination: "/?q=:prompt",
        permanent: true,
      },
      ...catalogKeys.map((key) => ({
        source: "/search",
        has: [{ type: "query" as const, key }],
        missing: [{ type: "query" as const, key: "q" }, { type: "query" as const, key: "prompt" }],
        destination: "/catalog",
        permanent: true,
      })),
      { source: "/search", destination: "/", permanent: true },
      // The shelves index is the home page's shelves section; each shelf keeps its own page.
      { source: "/shelves", destination: "/#shelves", permanent: true },
    ];
  },
  async rewrites() {
    // A product URL carrying the shopper's goal, diet or shopping context renders per request
    // (app/product/[slug]/live); the plain URL is the cached page. The query string passes through.
    return {
      beforeFiles: [
        ...PRODUCT_LIVE_QUERY_KEYS.map((key) => ({
          source: "/product/:slug",
          has: [{ type: "query" as const, key }],
          destination: "/product/:slug/live",
        })),
        // Claim filters are cached pages per kind (app/insights/claims/kind/[kind]).
        {
          source: "/insights/claims",
          has: [{ type: "query" as const, key: "kind", value: "(?<kind>[a-z_]{1,32})" }],
          destination: "/insights/claims/kind/:kind",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "**.zeptonow.com" },
      { protocol: "https", hostname: "ik.imagekit.io" },
      { protocol: "https", hostname: "cdn.grofers.com" },
      { protocol: "https", hostname: "**.grofers.com" },
      { protocol: "https", hostname: "**.blinkit.com" },
      { protocol: "https", hostname: "*.cloudfront.net" },
      { protocol: "https", hostname: "images.openfoodfacts.org" },
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
    // Scroll to the top on navigation. The default handler looks for the new page's first
    // element, finds the route's script that React hoisted into <head>, and gives up: on a phone
    // a product page opened from far down the home page kept that depth.
    appNewScrollHandler: true,
  },
};

export default nextConfig;
