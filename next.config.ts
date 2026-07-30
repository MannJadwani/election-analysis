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
  // pdfjs-dist loads @napi-rs/canvas through a dynamic require() wrapped in a
  // try/catch, so Next's file tracer never sees it and omits the package — plus
  // its native skia .node binaries — from the /api/ingest lambda. That surfaces
  // at runtime as "Cannot find module '@napi-rs/canvas'" → "DOMMatrix is not
  // defined". Force-include the package and its Linux binaries into the trace.
  outputFileTracingIncludes: {
    "/api/ingest": [
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-musl/**/*",
    ],
  },
};

export default nextConfig;
