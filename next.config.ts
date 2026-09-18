import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 native modüldür; bundle edilmemeli.
  serverExternalPackages: ["better-sqlite3"],
  // Yerelde 127.0.0.1 üzerinden erişim de HMR/dev kaynaklarını kullanabilsin.
  allowedDevOrigins: ["127.0.0.1"],
  // CSP proxy.ts'te (her istekte nonce üretilir); burada sabit başlıklar durur.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
