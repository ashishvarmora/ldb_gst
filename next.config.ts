import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions receive plan/limit payloads; keep the default 1MB cap.
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
