/**
 * Stellar Confidential Token SDK Integration.
 *
 * Implements registerAccount, depositTokens, confidentialTransfer,
 * decryptSupplierPayments, and auditAllTransfers using the official SDK functions:
 * ChainClient, submitRegister, submitDeposit, submitTransfer, fetchEvents,
 * auditTransfer, JsonFileStore, loadCircuit, randomScalar, auditorPublicKey,
 * pointToBytes, StateEngine, CircuitProver, etc.
 */

import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import {
  ChainClient,
  keypairSigner,
  submitRegister,
  submitDeposit,
  submitTransfer,
  submitMerge,
  fetchEvents,
  auditTransfer,
  randomScalar,
  auditorPublicKey,
  pointToBytes,
  StateEngine,
  CircuitProver,
  buildRegisterWitness,
  buildTransferWitness,
  deriveKeys,
  addressToField,
  type TransferEvent,
  type Point,
} from "stellar-confidential-token-sdk";
import { loadCircuit } from "stellar-confidential-token-sdk/proving/artifacts";
import { JsonFileStore } from "stellar-confidential-token-sdk/state/json-store";
import { config } from "./config.js";

// ---------------------------------------------------------------------------
// Helpers & Key Resolution
// ---------------------------------------------------------------------------

export function publicKeyFrom(secret: string): string {
  return Keypair.fromSecret(secret).publicKey();
}

export const businessAddress = publicKeyFrom(config.businessSecret);
export const supplierAddress = publicKeyFrom(config.supplierSecret);
export const auditorAddress = publicKeyFrom(config.auditorSecret);

/**
 * Deterministically derive a 256-bit Grumpkin scalar from a Stellar secret key.
 */
function scalarFromSecret(secret: string): bigint {
  const kp = Keypair.fromSecret(secret);
  const rawBytes = kp.rawSecretKey();
  let hex = "";
  for (const b of rawBytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return BigInt("0x" + hex);
}

const businessSk = scalarFromSecret(config.businessSecret);
const supplierSk = scalarFromSecret(config.supplierSecret);
const auditorK = scalarFromSecret(config.auditorSecret);

const tokenAddrF = addressToField(config.confidentialContractId);
const businessKeys = deriveKeys(businessSk, tokenAddrF);
const supplierKeys = deriveKeys(supplierSk, tokenAddrF);

// ---------------------------------------------------------------------------
// Retry Wrapper (txBadSeq)
// ---------------------------------------------------------------------------

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes("txBadSeq") || msg.includes("tx_bad_seq")) {
      console.warn("txBadSeq encountered. Waiting 2s and retrying once...");
      await sleep(2000);
      return fn();
    }
    throw err;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Initialization & Provers
// ---------------------------------------------------------------------------

let chainClient: ChainClient;
let registerProver: CircuitProver;
let transferProver: CircuitProver;
let businessEngine: StateEngine;
let isInitialized = false;

export async function ensureInitialized(): Promise<void> {
  if (isInitialized) return;

  chainClient = new ChainClient({
    rpcUrl: config.stellarRpcUrl,
    networkPassphrase: config.stellarPassphrase,
    contracts: {
      token: config.confidentialContractId,
      verifier: config.confidentialContractId,
      auditor: config.confidentialContractId,
    },
  });

  const registerCircuit = loadCircuit("register");
  registerProver = new CircuitProver(registerCircuit);

  const transferCircuit = loadCircuit("transfer");
  transferProver = new CircuitProver(transferCircuit);

  const latest = await chainClient.latestLedger().catch(() => 1000);
  const safeStartLedger = Math.max(1, latest - 1000);

  const storePath = path.resolve("data", "business-state.json");
  const store = new JsonFileStore(storePath);

  businessEngine = new StateEngine({
    client: chainClient,
    store,
    keys: businessKeys,
    address: businessAddress,
    fromLedger: safeStartLedger,
  });

  isInitialized = true;
  console.log("Stellar Confidential Token SDK initialized successfully.");
}

async function getSafeStartLedger(): Promise<number> {
  try {
    const latest = await chainClient.latestLedger();
    // RPC retention window is ~100,000 ledgers (~7 days). Start 10,000 back.
    return Math.max(1, latest - 10000);
  } catch {
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Register Account
// ---------------------------------------------------------------------------

export async function registerAccount(secretKey: string): Promise<void> {
  await ensureInitialized();
  const address = publicKeyFrom(secretKey);
  const signer = keypairSigner(secretKey, config.stellarPassphrase);

  const alreadyRegistered = await chainClient.isRegistered(address).catch(() => false);
  if (alreadyRegistered) {
    console.log(`Account ${address} is already registered.`);
    return;
  }

  const sk = scalarFromSecret(secretKey);
  const keys = deriveKeys(sk, tokenAddrF);
  const witness = buildRegisterWitness(keys, address);

  console.log(`Generating UltraHonk proof for register(${address})...`);
  const proofResult = await registerProver.prove(witness.inputs);

  await withRetry(async () => {
    console.log(`Submitting register transaction for ${address}...`);
    return await submitRegister(
      chainClient,
      signer,
      address,
      0, // auditorId 0
      witness,
      proofResult.proof
    );
  });
  console.log(`Registered ${address} successfully.`);
}

// ---------------------------------------------------------------------------
// Deposit Tokens
// ---------------------------------------------------------------------------

export async function depositTokens(
  secretKey: string,
  amount: number
): Promise<void> {
  await ensureInitialized();
  const address = publicKeyFrom(secretKey);
  const signer = keypairSigner(secretKey, config.stellarPassphrase);

  await withRetry(async () => {
    console.log(`Submitting deposit: ${amount} for ${address}...`);
    return await submitDeposit(
      chainClient,
      signer,
      address,
      address,
      BigInt(amount)
    );
  });

  // Attempt merge so receiving balance becomes spendable
  try {
    console.log(`Merging receiving balance for ${address}...`);
    await withRetry(async () => {
      return await submitMerge(chainClient, signer, address);
    });
  } catch (err: any) {
    console.log("Merge step note:", err?.message ?? err);
  }

  if (address === businessAddress) {
    await businessEngine.sync().catch((e) => {
      console.warn("businessEngine sync error after deposit:", e?.message ?? e);
    });
  }
}

// ---------------------------------------------------------------------------
// Confidential Transfer
// ---------------------------------------------------------------------------

export async function confidentialTransfer(
  senderSecret: string,
  recipientAddress: string,
  amount: number
): Promise<string> {
  await ensureInitialized();
  const senderAddress = publicKeyFrom(senderSecret);
  const signer = keypairSigner(senderSecret, config.stellarPassphrase);

  const recipientAcct = await chainClient.confidentialBalance(recipientAddress);
  if (!recipientAcct) {
    throw new Error(`Recipient ${recipientAddress} is not registered on-chain.`);
  }

  await businessEngine.sync().catch(() => {});
  const spendable = await businessEngine.spendableForProof();

  const audKey = auditorPublicKey(auditorK);

  const witness = buildTransferWitness({
    keys: businessKeys,
    v: spendable.v,
    r: spendable.r,
    amount: BigInt(amount),
    pvkB: recipientAcct.viewingPublicKey,
    kAudR: audKey,
    kAudS: audKey,
    sigma: randomScalar(),
  });

  console.log(`Generating transfer proof (${amount} to ${recipientAddress})...`);
  const proofResult = await transferProver.prove(witness.inputs);

  const res = await withRetry(async () => {
    console.log(`Submitting confidential_transfer transaction...`);
    return await submitTransfer(
      chainClient,
      signer,
      senderAddress,
      recipientAddress,
      witness,
      proofResult.proof
    );
  });

  await businessEngine.setSpendable(witness.next).catch(() => {});
  return res.hash;
}

// ---------------------------------------------------------------------------
// Decrypt Supplier Payments
// ---------------------------------------------------------------------------

export async function decryptSupplierPayments(): Promise<
  Array<{ amount: number; txHash: string }>
> {
  await ensureInitialized();
  const startLedger = await getSafeStartLedger();

  let events: any[] = [];
  try {
    const res = await fetchEvents(chainClient, {
      startLedger,
      contractId: config.confidentialContractId,
    });
    events = res.events;
  } catch (err: any) {
    console.warn("fetchEvents warning in decryptSupplierPayments:", err?.message ?? err);
    return [];
  }

  const payments: Array<{ amount: number; txHash: string }> = [];

  for (const ev of events) {
    if (ev.type === "transfer") {
      const tev = ev as TransferEvent;
      if (tev.to === supplierAddress) {
        try {
          const audited = auditTransfer(auditorK, tev);
          payments.push({
            amount: Number(audited.amount),
            txHash: tev.txHash,
          });
        } catch {
          // If decryption fails for this event, ignore
        }
      }
    }
  }

  return payments;
}

// ---------------------------------------------------------------------------
// Auditor Ledger
// ---------------------------------------------------------------------------

export interface AuditedTransfer {
  date: string;
  supplier: string;
  amount: number;
  txHash: string;
}

export async function auditAllTransfers(): Promise<AuditedTransfer[]> {
  await ensureInitialized();
  const startLedger = await getSafeStartLedger();

  let events: any[] = [];
  try {
    const res = await fetchEvents(chainClient, {
      startLedger,
      contractId: config.confidentialContractId,
    });
    events = res.events;
  } catch (err: any) {
    console.warn("fetchEvents warning in auditAllTransfers:", err?.message ?? err);
    return [];
  }

  const out: AuditedTransfer[] = [];

  for (const ev of events) {
    if (ev.type === "transfer") {
      const tev = ev as TransferEvent;
      try {
        const audited = auditTransfer(auditorK, tev);
        out.push({
          date: new Date().toISOString().split("T")[0],
          supplier: tev.to,
          amount: Number(audited.amount),
          txHash: tev.txHash,
        });
      } catch {
        // Event not intended for this auditor or decrypt failure
      }
    }
  }

  return out;
}
