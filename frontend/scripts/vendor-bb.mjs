import { cp, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sdkEntry = import.meta.resolve("stellar-confidential-token-sdk");
const sdkRequire = createRequire(sdkEntry);
let packageDir = dirname(sdkRequire.resolve("@aztec/bb.js"));

while (
  !existsSync(join(packageDir, "package.json")) ||
  JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).name !== "@aztec/bb.js"
) {
  const parent = dirname(packageDir);
  if (parent === packageDir) throw new Error("Could not locate @aztec/bb.js package directory.");
  packageDir = parent;
}
packageDir = realpathSync(packageDir);
const packageInfo = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));

const browserDir = join(packageDir, "dest", "browser");
if (!existsSync(join(browserDir, "index.js"))) {
  throw new Error(`bb.js browser bundle is missing under ${browserDir}`);
}

const destination = resolve(here, "../public/vendor/bb");
await mkdir(destination, { recursive: true });
await cp(browserDir, destination, { recursive: true });
console.log(`Vendored @aztec/bb.js ${packageInfo.version} into public/vendor/bb`);
