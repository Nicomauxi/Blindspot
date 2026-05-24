import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow LAN access from any IP — Next.js 15.3 DNS-rebinding protection blocks non-localhost by default
  allowedDevHosts: process.env["NEXT_ALLOWED_DEV_HOSTS"]?.split(",") ?? ["all"],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001"}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
