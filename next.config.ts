import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 native modüldür; bundle edilmemeli.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
