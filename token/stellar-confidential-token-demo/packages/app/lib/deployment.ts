/**
 * Deployments the app can serve.
 *
 * The app always knows the built-in {@link DEFAULT_DEPLOYMENT} (the canonical
 * vanilla token from deployments/testnet.json). In "advanced mode" the user
 * deploys their own confidential token via the shared factory and the app
 * serves that deployment instead — see lib/active-deployment.tsx, which tracks
 * which one is active and persists the advanced one in localStorage.
 *
 * The verifier and auditor are CONSTANT across deployments (a factory-deployed
 * token is wired to the same registries), so the auditor key fields below are
 * shared by every deployment.
 *
 * ⚠️ Demo-only exception: `auditorSecretHex` is the auditor's Grumpkin SECRET
 * key, published here so anyone can play the auditor persona on /auditor. In
 * any real deployment this never leaves the auditor's machine — only the
 * public key `K_aud = k·H` goes on-chain (auditor contract registry).
 */
import { Networks } from "@stellar/stellar-sdk";

/**
 * The contracts' protocol release. A saved deployment from another release
 * can't decode this release's events, or this one's its, so it is dropped on
 * load (lib/active-deployment.tsx).
 */
export const PROTOCOL = "stellar-confidential 0.8.0";

/** Which confidential-token configuration a deployment uses. */
export type CtKind = "vanilla" | "compliance" | "allowlist" | "blocklist";

export interface DeploymentContracts {
  token: string;
  verifier: string;
  auditor: string;
  underlying: string;
  /**
   * Shared token factory the advanced-mode wizard invokes. Empty until
   * `scripts/deploy.ts` has provisioned it and its id is pasted in below.
   */
  factory: string;
  /** Policy contract — present only for `allowlist` / `blocklist` kinds. */
  policy?: string;
}

export interface Deployment {
  /** Stable id; `"default"` for the built-in deployment, `"advanced"` otherwise. */
  id: string;
  /** Short human label shown in the deployment selector. */
  label: string;
  kind: CtKind;
  /** {@link PROTOCOL} at the time the deployment was created. */
  protocol: string;
  rpcUrl: string;
  networkPassphrase: string;
  /**
   * Goldsky indexer base URL (full-history event source). Read at build time
   * from NEXT_PUBLIC_INDEXER_URL; constant across deployments.
   */
  indexerUrl?: string;
  /** Ledger the token was deployed at — the first-sync start point. */
  deployedAtLedger: number;
  /** Every account in this demo registers under this auditor id. */
  auditorId: number;
  /** Auditor Grumpkin secret `k` (see header warning). */
  auditorSecretHex: string;
  contracts: DeploymentContracts;
  /**
   * The token's access-control admin (G-address), who grants the freezer,
   * config_manager and clawback roles. Set for compliant deployments created in
   * advanced mode (the deployer becomes the admin). Absent for vanilla (no
   * admin) and for the built-in default.
   */
  admin?: string;
}

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || undefined;

export const DEFAULT_DEPLOYMENT: Deployment = {
  id: "default",
  label: "Default Confidential Token",
  kind: "vanilla",
  protocol: PROTOCOL,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  indexerUrl: INDEXER_URL,
  deployedAtLedger: 5371973,
  auditorId: 0,
  auditorSecretHex: "0x1165798bd0efb257cca0ac3d1d88bb549267d30a23fcb3c4e69eea4b7f872bc7",
  contracts: {
    token: "CA642WUED6PACAQGVKSXND3DRSXGR7DP2L7TRHZORPWEPNRVGGN4L4ED",
    verifier: "CAN45PFA5CVUCU3JB77IE2JNWNTRCDWMRNG55U452L3N2IOCAGOLTUVQ",
    auditor: "CBQZRK72Y6KJ5DR4CUHKLHMHIKBMOZNSYTWHRUQPEXA35PRCBMSPBZTW",
    underlying: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    // ⚠️ Paste the factory id printed by `scripts/deploy.ts` here. Advanced
    // mode is disabled in the UI until this is set.
    factory: "CAWPCXMW47UET5Z4N5T44PRDGAY6CZVP2O2JDEBL7YWEUHJGQ2BR4L6R",
  },
};

/** The XLM Stellar Asset Contract — the default underlying for advanced mode. */
export const XLM_SAC = DEFAULT_DEPLOYMENT.contracts.underlying;

/** Human label for a CT kind (used across the advanced wizard + admin UI). */
export function kindLabel(kind: CtKind): string {
  switch (kind) {
    case "vanilla":
      return "Default Confidential Token";
    case "compliance":
      return "Confidential Token with compliance (freeze only)";
    case "allowlist":
      return "Confidential Token with compliance + allowlist policy";
    case "blocklist":
      return "Confidential Token with compliance + blocklist policy";
  }
}

/**
 * Whether a deployment exposes the Token Admin dashboard. True for compliant
 * kinds (role-gated compliance management) and also for a vanilla token
 * deployed in advanced mode — it has no admin or compliance to manage, but the
 * dashboard is the only place to redeploy, so it must stay reachable. The
 * built-in default is excluded either way: nothing to manage, nothing to
 * redeploy.
 */
export function hasAdminDashboard(deployment: Pick<Deployment, "id">): boolean {
  return deployment.id !== "default";
}
