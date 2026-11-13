/**
 * The confidential wallet generates UltraHonk proofs in the browser via bb.js,
 * which needs multithreading → SharedArrayBuffer → cross-origin isolation.
 *
 * We set COOP=same-origin and COEP=credentialless. `credentialless` (rather
 * than `require-corp`) keeps the page cross-origin isolated while still letting
 * `fetch()` reach the Soroban RPC without that endpoint having to send CORP
 * headers.
 */
const crossOriginIsolation = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["stellar-confidential-token-sdk"],
  async headers() {
    return [{ source: "/(.*)", headers: crossOriginIsolation }];
  },
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true, topLevelAwait: true };
    // bb.js / noir pull in optional Node built-ins that the browser doesn't need.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
    // Never bundle bb.js on the client. Its pre-built browser bundle declares a
    // top-level `__webpack_exports__` that collides with webpack's module
    // runtime, and it spawns a wasm Web Worker via `new Worker(new URL(
    // './main.worker.js', import.meta.url))` whose sibling files can't live in a
    // hashed `_next` chunk. The browser loads bb.js as native ESM from
    // /vendor/bb instead (see lib/bb-loader.ts), so the bundler must leave the
    // bare specifier alone — only the SDK's Node-only default loader references
    // it, and the app overrides that before proving.
    if (!isServer) {
      config.resolve.alias = { ...config.resolve.alias, "@aztec/bb.js": false };
    }
    return config;
  },
};

export default nextConfig;
