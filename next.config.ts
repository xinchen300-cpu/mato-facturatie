import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded from node_modules at runtime; pdfkit reads its font metrics (.afm) from disk.
  serverExternalPackages: ["pdfkit", "exceljs", "nodemailer"],
  outputFileTracingIncludes: { "/**": ["./node_modules/pdfkit/js/data/**"] },
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
      ],
    }];
  },
};

export default nextConfig;
