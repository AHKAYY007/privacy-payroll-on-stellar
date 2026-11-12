import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

// Ensure environment variables are loaded in Node.js ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Look for .env files in backend directory, project root, and current working directory
const envCandidates = [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(process.cwd(), ".env"),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}
dotenv.config();

function getEnv(name: string, fallback: string): string {
  const val = process.env[name];
  if (!val || val.trim() === "") {
    return fallback;
  }
  const trimmed = val.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const rawPort = process.env.PORT;
const port = rawPort && !isNaN(Number(rawPort)) ? Number(rawPort) : 3001;

const stellarRpcUrl = getEnv(
  "STELLAR_RPC_URL",
  "https://soroban-testnet.stellar.org:443"
);
const stellarPassphrase = getEnv(
  "STELLAR_NETWORK_PASSPHRASE",
  "Test SDF Network ; September 2015"
);

const tokenContractId = getEnv(
  "TOKEN_CONTRACT_ID",
  "CA642WUED6PACAQGVKSXND3DRSXGR7DP2L7TRHZORPWEPNRVGGN4L4ED"
);
const confidentialContractId = getEnv(
  "CONFIDENTIAL_CONTRACT_ID",
  "CA642WUED6PACAQGVKSXND3DRSXGR7DP2L7TRHZORPWEPNRVGGN4L4ED"
);
const verifierContractId = getEnv(
  "VERIFIER_CONTRACT_ID",
  "CAN45PFA5CVUCU3JB77IE2JNWNTRCDWMRNG55U452L3N2IOCAGOLTUVQ"
);
const auditorContractId = getEnv(
  "AUDITOR_CONTRACT_ID",
  "CBQZRK72Y6KJ5DR4CUHKLHMHIKBMOZNSYTWHRUQPEXA35PRCBMSPBZTW"
);

const supplierSecret = getEnv(
  "SUPPLIER_SECRET",
  ""
);
const supplierAddress = getEnv("SUPPLIER_ADDRESS", "");
const supplierName = getEnv("SUPPLIER_NAME", "Emeka Supplies");
const auditorGrumpkinSecretHex = getEnv("AUDITOR_GRUMPKIN_SECRET_HEX", "");
const auditorId = Number(getEnv("AUDITOR_ID", "0"));
const tokenDeployedAtLedger = Number(getEnv("TOKEN_DEPLOYED_AT_LEDGER", "5371973"));

if (!Number.isInteger(auditorId) || auditorId < 0) {
  throw new Error("AUDITOR_ID must be a non-negative integer.");
}
if (!Number.isInteger(tokenDeployedAtLedger) || tokenDeployedAtLedger < 1) {
  throw new Error("TOKEN_DEPLOYED_AT_LEDGER must be a positive integer.");
}
export const config = {
  port,
  stellarRpcUrl,
  stellarPassphrase,
  tokenContractId,
  confidentialContractId,
  verifierContractId,
  auditorContractId,
  supplierSecret,
  supplierAddress,
  supplierName,
  auditorGrumpkinSecretHex,
  auditorId,
  tokenDeployedAtLedger,

  // Compatibility aliases matching env var names
  PORT: port,
  STELLAR_RPC_URL: stellarRpcUrl,
  STELLAR_NETWORK_PASSPHRASE: stellarPassphrase,
  TOKEN_CONTRACT_ID: tokenContractId,
  CONFIDENTIAL_CONTRACT_ID: confidentialContractId,
  VERIFIER_CONTRACT_ID: verifierContractId,
  AUDITOR_CONTRACT_ID: auditorContractId,
  SUPPLIER_SECRET: supplierSecret,
} as const;

export default config;
