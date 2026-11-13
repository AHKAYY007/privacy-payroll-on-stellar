/**
 * Browser bb.js loader.
 *
 * bb.js's `dest/browser/` is copied verbatim into `public/vendor/bb/` by
 * scripts/vendor-bb.mjs (run via the app's predev/prebuild). We load it as a
 * NATIVE ES module from that stable path instead of letting webpack bundle it,
 * because bb.js resolves its wasm Web Worker relative to `import.meta.url`
 * (`new Worker(new URL('./main.worker.js', import.meta.url))`, marked
 * `webpackIgnore`). Bundling moves `index.js` into a hashed `_next` chunk whose
 * sibling `main.worker.js` doesn't exist, so the worker never loads and proving
 * hangs. Served from `/vendor/bb/index.js`, `import.meta.url` points at a real
 * directory where the worker + wasm files are present.
 *
 * `nativeImport` is built with `new Function` so webpack never sees an
 * `import()` to analyze/rewrite (and so no magic-comment survives SWC concerns).
 * It is constructed lazily inside the loader callback: `new Function` is
 * forbidden on Cloudflare Workers (EvalError: code generation from strings),
 * and this module gets pulled into the SSR bundle even though proving is
 * browser-only.
 */
import { setUltraHonkBackendLoader } from "stellar-confidential-token-sdk";

let nativeImport: ((url: string) => Promise<Record<string, unknown>>) | undefined;

function getNativeImport(): (url: string) => Promise<Record<string, unknown>> {
  nativeImport ??= new Function("url", "return import(url)") as (
    url: string,
  ) => Promise<Record<string, unknown>>;
  return nativeImport;
}

const BB_URL = "/vendor/bb/index.js";

let registered = false;

/** Point the SDK prover at the native-ESM bb.js. Idempotent; browser-only. */
export function ensureBrowserBackend(): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  setUltraHonkBackendLoader(async () => {
    const mod = await getNativeImport()(BB_URL);
    return mod.UltraHonkBackend as never;
  });
}
