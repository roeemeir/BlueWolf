import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Cloudflare is used only by the hosted demo adapter, never by local storage.
  webpack(config) {
    config.externals ??= [];
    config.externals.push("cloudflare:workers");
    return config;
  },
};

export default nextConfig;
