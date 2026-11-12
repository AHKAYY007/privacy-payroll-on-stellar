import { setUltraHonkBackendLoader } from "stellar-confidential-token-sdk";

let nativeImport: ((url: string) => Promise<Record<string, unknown>>) | undefined;
let registered = false;

export function ensureBrowserBackend(): void {
  if (registered || typeof window === "undefined") return;
  if (!window.crossOriginIsolated) {
    throw new Error("This page is not cross-origin isolated. Restart the Vite app so confidential proof generation can load safely.");
  }
  registered = true;
  nativeImport ??= new Function("url", "return import(url)") as (
    url: string,
  ) => Promise<Record<string, unknown>>;

  setUltraHonkBackendLoader(async () => {
    const module = await nativeImport!("/vendor/bb/index.js");
    return module.UltraHonkBackend as never;
  });
}
