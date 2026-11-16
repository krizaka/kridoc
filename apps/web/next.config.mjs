import { fileURLToPath } from "node:url";

// @fixed: the registered dev host of Kridoc (lib/dev-host.ts keeps the same name)
const DEV_HOST = "dev.kridoc.com";
const production = process.env.NODE_ENV === "production";
// Nothing but this origin (+ the media CDN): no third-party script, frame or font.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://krizaka-assets.b-cdn.net",
  "media-src 'self' https://krizaka-assets.b-cdn.net",
  "font-src 'self' data:",
  `connect-src 'self'${production ? "" : " ws: http://localhost:* http://127.0.0.1:*"}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  reactStrictMode: true,
  poweredByHeader: false,
  // The optional OpenDAL binding of @krizaka/storage is not installed (Kridoc's bucket and folder adapters never use it): the bundler
  // loads a stand-in that fails like a missing package, so the library answers its own « optional dependency » refusal.
  turbopack: { resolveAlias: { opendal: "./lib/storage/opendal-absent.ts" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // The development address (an alias of this app) is never indexed, robots.txt included (it bypasses proxy.ts, lib/dev-host.ts).
      {
        source: "/:path*",
        has: [{ type: "host", value: DEV_HOST }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      { source: "/.well-known/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
