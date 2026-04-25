import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // network-core-sdk loads native algorithm bindings via require() and bundles
  // a noisy graph of optional deps (ws, bufferutil, utf-8-validate). Mark it
  // external so Turbopack doesn't try to trace it into the server bundle.
  serverExternalPackages: [
    "@primuslabs/network-core-sdk",
    // Without this, Turbopack bundles a copy of ethers next to the SDK's
    // nested copy, and `provider instanceof ethers.providers.JsonRpcProvider`
    // checks inside the SDK silently fail — the provider falls through to a
    // network-detect path that throws `noNetwork`.
    "ethers",
  ],

  // bb.js spins up its own Web Worker pool and ships its own WASM. Tell Next
  // to transpile the package directly from source instead of treating it as
  // a pre-bundled black box (which breaks the worker URLs).
  transpilePackages: ["@aztec/bb.js", "@noir-lang/noir_js"],

  // Multi-threaded WASM via SharedArrayBuffer requires the page to be
  // cross-origin-isolated. Without these headers, bb.js falls back to the
  // single-threaded WASM path and proving is roughly N× slower (where N =
  // hardwareConcurrency). `same-origin` COOP + `require-corp` COEP is the
  // standard recipe; downstream pages must serve any cross-origin sub-
  // resources with `Cross-Origin-Resource-Policy: cross-origin` or use
  // `crossorigin="anonymous"` with a CORS-permissive response.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
