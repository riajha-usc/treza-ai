import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The container image runs the standalone server; local dev and tests keep the default layout.
  output: process.env.NEXT_STANDALONE ? "standalone" : undefined,
  // Embedded Postgres ships a WebAssembly build; load it with Node's require.
  serverExternalPackages: ["@electric-sql/pglite"],
  cacheComponents: true,
  partialPrefetching: true,
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
