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
};

export default nextConfig;
