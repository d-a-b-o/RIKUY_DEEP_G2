import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security/policy";

const nextConfig: NextConfig = {
  // Request-specific CSP nonces require dynamic rendering, without PPR.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
