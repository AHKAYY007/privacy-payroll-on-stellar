import path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import {
  ChainClient,
  CircuitProver,
  addressToField,
  auditTransfer,
  auditorPublicKey,
  buildRegisterWitness,
  deriveKeys,
  deriveSk,
  fetchEvents,
  keypairSigner,
  sep53Payload,
  skSigningMessage,
  StateEngine,
  submitRegister,
  type KeyPair,
  type TransferEvent,
} from "stellar-confidential-token-sdk";
import { JsonFileStore } from "stellar-confidential-token-sdk/state/json-store";
import { loadCircuit } from "stellar-confidential-token-sdk/proving/artifacts";
import { fromHex } from "stellar-confidential-token-sdk";
import { config } from "./config.js";

/** Derive the public address from a secret key. */
export function publicKeyFrom(secret: string): string {
  return Keypair.fromSecret(secret).publicKey();
}

function supplierSecretAddress(): string | null {
  if (!config.supplierSecret) return null;
  try {
    return publicKeyFrom(config.supplierSecret);
  } catch {
    return null;
  }
}

export const supplierAddress = config.supplierAddress || supplierSecretAddress() || "";

const STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/confidential-state.json",
);
const stateStore = new JsonFileStore(STATE_FILE);
const keysByAddress = new Map<string, KeyPair>();

interface SdkContext {
  client: ChainClient;
  registerProver: CircuitProver;
}

let sdkInitialization: Promise<SdkContext> | undefined;

async function getSdk(): Promise<SdkContext> {
  if (!sdkInitialization) {
    sdkInitialization = Promise.resolve().then(() => ({
      client: new ChainClient({
        rpcUrl: config.stellarRpcUrl,
        networkPassphrase: config.stellarPassphrase,
        contracts: {
          token: config.confidentialContractId,
          verifier: config.verifierContractId,
          auditor: config.auditorContractId,
        },
      }),
      registerProver: new CircuitProver(loadCircuit("register")),
    })).catch((error: unknown) => {
      sdkInitialization = undefined;
      throw error;
    });
  }
  return sdkInitialization;
}

function accountMaterial(secret: string) {
  const keypair = Keypair.fromSecret(secret);
  const address = keypair.publicKey();
  let keys = keysByAddress.get(address);
  if (!keys) {
    const root = keypair.sign(
      sep53Payload(skSigningMessage(config.confidentialContractId, address)) as Buffer,
    );
    const sk = deriveSk(root, config.confidentialContractId, address).sk;
    keys = deriveKeys(sk, addressToField(config.confidentialContractId));
    keysByAddress.set(address, keys);
  }

  return {
    address,
    keys,
    signer: keypairSigner(secret, config.stellarPassphrase),
  };
}

function stateEngine(client: ChainClient, address: string, keys: KeyPair): StateEngine {
  return new StateEngine({
    client,
    store: stateStore,
    keys,
    address,
    fromLedger: config.tokenDeployedAtLedger,
  });
}

function stroopsToXlm(amount: bigint): number {
  return Number(amount) / 10_000_000;
}

function engineForAccount(
  client: ChainClient,
  address: string,
  keys: KeyPair,
): StateEngine {
  return stateEngine(client, address, keys);
}

async function fetchRecentEvents(client: ChainClient) {
  const latestLedger = await client.latestLedger();
  return fetchEvents(client, {
    startLedger: Math.max(config.tokenDeployedAtLedger, latestLedger - 120_000),
    contractId: config.confidentialContractId,
  });
}

async function ensureRegistered(secretKey: string, context: SdkContext): Promise<void> {
  const { address, keys, signer } = accountMaterial(secretKey);
  const existing = await context.client.confidentialBalance(address);
  if (existing) {
    if (
      !existing.spendingKey.equals(keys.Y) ||
      !existing.viewingPublicKey.equals(keys.PVK)
    ) {
      throw new Error(
        `${address} is already registered with different confidential keys.`,
      );
    }
    if (existing.auditorId !== config.auditorId) {
      throw new Error(
        `${address} is registered under auditor id ${existing.auditorId}, expected ${config.auditorId}.`,
      );
    }
    return;
  }

  const witness = buildRegisterWitness(keys, address);
  const { proof } = await context.registerProver.prove(witness.inputs);
  await withRetry(() =>
    submitRegister(
      context.client,
      signer,
      address,
      config.auditorId,
      witness,
      proof,
    ),
  );
}

/** Retry one txBadSeq submission after the previous testnet transaction settles. */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes("txBadSeq") || msg.includes("tx_bad_seq")) {
      console.warn("txBadSeq encountered. Waiting 2s and retrying once...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return fn();
    }
    throw err;
  }
}

/** Register an account for confidential tokens if it is not already registered. */
export async function registerAccount(secretKey: string): Promise<void> {
  const context = await getSdk();
  await ensureRegistered(secretKey, context);
}

/** Verify or register the configured supplier account without signing as the payer. */
export async function ensureSupplierAccount(): Promise<void> {
  if (!supplierAddress) {
    throw new Error("Set SUPPLIER_ADDRESS or SUPPLIER_SECRET in backend/.env.");
  }
  const secretAddress = supplierSecretAddress();
  if (config.supplierSecret && !secretAddress && !config.supplierAddress) {
    throw new Error(
      "SUPPLIER_SECRET is not a valid Stellar secret key (it must start with S...). Set the supplier's public G... address in SUPPLIER_ADDRESS instead.",
    );
  }
  if (secretAddress && config.supplierAddress && secretAddress !== config.supplierAddress) {
    throw new Error("SUPPLIER_SECRET and SUPPLIER_ADDRESS refer to different supplier accounts.");
  }
  if (secretAddress) {
    await registerAccount(config.supplierSecret);
  }
}

export interface AuditedTransfer {
  date: string;
  supplier: string;
  amount: number;
  txHash: string;
}

/** Decrypt transfer events using the Grumpkin scalar registered for the auditor ID. */
export async function auditAllTransfers(): Promise<AuditedTransfer[]> {
  const context = await getSdk();
  if (!config.auditorGrumpkinSecretHex) {
    throw new Error("Set AUDITOR_GRUMPKIN_SECRET_HEX to the scalar registered for this auditor id.");
  }
  const auditorSecret = fromHex(config.auditorGrumpkinSecretHex);
  const [registeredAuditorKey, eventsResult] = await Promise.all([
    context.client.auditorKey(config.auditorId),
    fetchRecentEvents(context.client),
  ]);
  if (!auditorPublicKey(auditorSecret).equals(registeredAuditorKey)) {
    throw new Error("AUDITOR_GRUMPKIN_SECRET_HEX does not match the key registered on-chain.");
  }

  return eventsResult.events
    .filter((event): event is TransferEvent => event.type === "transfer")
    .map((event) => {
      const decrypted = auditTransfer(auditorSecret, event);
      if (!decrypted.channelsAgree) {
        throw new Error(`Auditor channels disagree for transaction ${event.txHash}.`);
      }
      return {
        date: `Ledger ${event.ledger}`,
        supplier: event.to,
        amount: stroopsToXlm(decrypted.amount),
        txHash: event.txHash,
      };
    });
}
