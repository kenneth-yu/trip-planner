import { realpathSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const dependencyRoot = path.dirname(realpathSync(path.join(import.meta.dirname, "node_modules")));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: { root: dependencyRoot },
  outputFileTracingRoot: dependencyRoot,
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
