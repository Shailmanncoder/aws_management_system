import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Static security headers for every response. The CSP (with a per-request nonce) is set in
 * src/proxy.ts. See docs/SECURITY_HEADERS.md for rationale.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  // Standalone output is for the Docker image. Vercel builds and hosts the app itself, and the
  // standalone server is both unnecessary and unsupported there, so it is disabled on Vercel.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
  poweredByHeader: false,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  // Server-only packages that must not be bundled into client code.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  typedRoutes: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
