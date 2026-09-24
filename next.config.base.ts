import type { NextConfig } from "next";

// Apart from next.config.ts, whose plugin throws outside `varlock run`, so
// tests can import the configuration.
export const baseConfig: NextConfig = {
  // D22. Packaging only: the runtime of each route is set in the root layout.
  output: "standalone",

  // Do not advertise the framework in every response.
  poweredByHeader: false,

  // `next dev` would otherwise append its own block to CLAUDE.md, which is
  // normative here.
  agentRules: false,

  experimental: {
    // #60: the build cache stores the resolved environment, secrets included,
    // and CI and Docker always start from an empty .next anyway.
    turbopackFileSystemCacheForBuild: false,
  },
};
