/**
 * Vendor @aztec/bb.js's browser build into the app's public/ directory.
 *
 * Why: bb.js spawns its wasm Web Worker with
 *   new Worker(new URL(/* webpackIgnore *​/ './main.worker.js', import.meta.url), { type: 'module' })
 * The `webpackIgnore` means a bundler neither rewrites that URL nor emits the
 * worker file, so once webpack bundles bb.js into a hashed chunk the worker
 * resolves to a non-existent `/_next/static/chunks/main.worker.js` and proving
 * hangs forever. Serving the intact `dest/browser/` directory at a stable
 * public path lets `import.meta.url`-relative resolution find the sibling
 * worker + wasm files. The app loads it as native ESM (see lib/bb-loader.ts),
 * bypassing webpack entirely.
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSIONS } from "stellar-confidential-token-sdk";

const here = dirname(fileURLToPath(import.meta.url));

// Locate bb.js's dest/browser through the SDK, the package that actually
// depends on it: pnpm doesn't hoist bb.js, and the first `@aztec+bb.js@*` in
// the store need not be the version the SDK (and the on-chain verifier) pins.
function findBrowserDir() {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("stellar-confidential-token-sdk/circuits/manifest.json");
  const sdkDir = realpathSync(resolve(dirname(manifest), ".."));
  // bb.js exports only ".", so resolve its entry and walk up to the package root.
  let dir = dirname(createRequire(join(sdkDir, "package.json")).resolve("@aztec/bb.js"));
  while (!existsSync(join(dir, "package.json")) || readPkg(dir).name !== "@aztec/bb.js") {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not find @aztec/bb.js's package root from ${sdkDir}`);
    dir = parent;
  }
  const { version } = readPkg(dir);
  if (version !== VERSIONS.toolchain.bbJs) {
    throw new Error(
      `@aztec/bb.js ${version} resolved from the SDK, but the SDK pins ${VERSIONS.toolchain.bbJs}`,
    );
  }
  const browserDir = join(dir, "dest", "browser");
  if (!existsSync(join(browserDir, "index.js"))) {
    throw new Error(`@aztec/bb.js ${version} has no dest/browser/index.js under ${dir}`);
  }
  return { browserDir, version };
}

function readPkg(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

const { browserDir: srcDir, version } = findBrowserDir();

const destDir = resolve(here, "..", "packages", "app", "public", "vendor", "bb");
await mkdir(destDir, { recursive: true });
await cp(srcDir, destDir, { recursive: true });

const files = await readdir(destDir);
console.log(`vendored @aztec/bb.js ${version} browser build`);
console.log(`  from ${srcDir}`);
console.log(`  to   ${destDir}`);
console.log(`  files: ${files.join(", ")}`);
