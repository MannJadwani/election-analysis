import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages have Node-native / module-load side effects (PDF rendering,
  // OCR SDK) that must not be bundled — load them as real Node modules at runtime.
  serverExternalPackages: [
    "pdf-to-img",
    "pdfjs-dist",
    "unpdf",
    "@napi-rs/canvas",
    "@mistralai/mistralai",
    "@electric-sql/pglite",
    "pg",
  ],
};

export default nextConfig;
