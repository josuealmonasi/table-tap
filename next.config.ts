import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Menu photography lives in Supabase Storage. Only the project host is
    // allowed, so a stored URL can't be pointed at somewhere else to make our
    // optimiser fetch it.
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },
};

export default nextConfig;
