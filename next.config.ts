import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Keep Turbopack rooted at this package (avoids picking up a parent lockfile)
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;
