import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [
      {
        source: "/_next/:path*",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ];
  },
};

export default nextConfig;
