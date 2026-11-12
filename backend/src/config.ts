import "dotenv/config";

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),

  stellarRpcUrl: required("STELLAR_RPC_URL"),
  stellarPassphrase: required("STELLAR_NETWORK_PASSPHRASE"),

  tokenContractId: required("TOKEN_CONTRACT_ID"),
  confidentialContractId: required("CONFIDENTIAL_CONTRACT_ID"),

  businessSecret: required("BUSINESS_SECRET"),
  supplierSecret: required("SUPPLIER_SECRET"),
  auditorSecret: required("AUDITOR_SECRET"),
} as const;
