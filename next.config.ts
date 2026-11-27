import { realpathSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const dependencyRoot = path.dirname(realpathSync(path.join(import.meta.dirname, "node_modules")));

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: { root: dependencyRoot },
  outputFileTracingRoot: dependencyRoot,
};

export default nextConfig;
