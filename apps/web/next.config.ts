import type { NextConfig } from "next";

const staticSite = process.env.STATIC_SITE === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(staticSite
    ? {
        output: "export",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
