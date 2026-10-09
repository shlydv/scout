import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    // Old search URLs: ?prompt= (AI search) became ?q=; catalog filters moved to /catalog.
    // Query strings are passed through to the destination.
    const catalogKeys = ["category", "subcategory", "usecase", "brand", "grade", "verdict", "sublabel", "sort", "maxprice", "min", "goal", "diet", "slugs"];
    return [
      { source: "/blog", destination: "/", permanent: true },
      {
        source: "/search",
        has: [{ type: "query", key: "prompt", value: "(?<prompt>.+)" }],
        missing: [{ type: "query", key: "q" }],
        destination: "/search?q=:prompt",
        permanent: true,
      },
      ...catalogKeys.map((key) => ({
        source: "/search",
        has: [{ type: "query" as const, key }],
        missing: [{ type: "query" as const, key: "q" }, { type: "query" as const, key: "prompt" }],
        destination: "/catalog",
        permanent: true,
      })),
    ];
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
  },
};

export default nextConfig;
