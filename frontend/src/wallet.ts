import { Buffer } from "buffer";
import { Keypair } from "@stellar/stellar-sdk";
import {
  ChainClient,
  CircuitProver,
  LocalStorageStore,
  addressToField,
  buildRegisterWitness,
  buildTransferWitness,
  deriveKeys,
  deriveSk,
  fetchEvents,
  sep53Payload,
  skSigningMessage,
  StateEngine,
  submitDeposit,
  submitMerge,
  submitRegister,
  submitTransfer,
  type KeyPair,
  type Signer,
  type TransferEvent,
} from "stellar-confidential-token-sdk";
import registerCircuit from "stellar-confidential-token-sdk/circuits/register.json";
import transferCircuit from "stellar-confidential-token-sdk/circuits/transfer.json";
import {
  getNetwork,
  isConnected,
  requestAccess,
  signMessage,
  signTransaction,
} from "@stellar/freighter-api";
import type { PaymentHistoryEntry, PublicAppConfig, ReceivedPayment } from "./types";
import { ensureBrowserBackend } from "./bb-loader";

type WalletBalance = {
  spendable: number;
  receiving: number;
};

const STROOPS_PER_XLM = 10_000_000n;
type WalletSession = "holder" | "supplier";
const sessionWallets = new Map<WalletSession, ConfidentialWallet>();

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

function amountToStroops(value: string): bigint {
  if (!/^\d+(\.\d{1,7})?$/.test(value)) {
    throw new Error("Enter a positive amount with no more than 7 decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * STROOPS_PER_XLM + BigInt(fraction.padEnd(7, "0"));
  if (amount <= 0n) throw new Error("Enter a positive amount.");
  return amount;
}

function toXlm(stroops: bigint): number {
  return Number(stroops) / Number(STROOPS_PER_XLM);
}

async function deriveWalletKeys(address: string, config: PublicAppConfig): Promise<KeyPair> {
  const message = skSigningMessage(config.tokenContractId, address);
  const text = new TextDecoder().decode(message);
  const payload = Buffer.from(sep53Payload(message));
  const publicKey = Keypair.fromPublicKey(address);
  const signatures: Uint8Array[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await signMessage(text, {
      networkPassphrase: config.networkPassphrase,
      address,
    });
    if (result.error) throw new Error(describeError(result.error));
    if (result.signerAddress !== address) {
      throw new Error(`Freighter signed with ${result.signerAddress}, expected ${address}.`);
    }

    const signature =
      typeof result.signedMessage === "string"
        ? Uint8Array.from(atob(result.signedMessage), (character) => character.charCodeAt(0))
        : result.signedMessage;
    if (!signature) throw new Error("Freighter did not return a message signature.");
    if (!publicKey.verify(payload, Buffer.from(signature))) {
      throw new Error("Freighter returned a signature that does not match the connected account.");
    }
    signatures.push(new Uint8Array(signature));
  }

  const first = signatures[0]!;
  const second = signatures[1]!;
  if (first.length !== second.length || first.some((byte, index) => byte !== second[index])) {
    throw new Error("Freighter returned different signatures for the same key-derivation message.");
  }

  const secret = deriveSk(first, config.tokenContractId, address).sk;
  return deriveKeys(secret, addressToField(config.tokenContractId));
}

async function withSequenceRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = describeError(error);
    if (!message.includes("txBadSeq") && !message.includes("tx_bad_seq")) throw error;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return operation();
  }
}

export class ConfidentialWallet {
  readonly address: string;
  private readonly client: ChainClient;
  private readonly signer: Signer;
  private readonly keys: KeyPair;
  private readonly engine: StateEngine;
  private readonly registerProver: CircuitProver;
  private readonly transferProver: CircuitProver;
  private readonly auditorId: number;
  private readonly fromLedger: number;

  private constructor(
    address: string,
    config: PublicAppConfig,
    client: ChainClient,
    fromLedger: number,
    signer: Signer,
    keys: KeyPair,
  ) {
    this.address = address;
    this.auditorId = config.auditorId;
    this.fromLedger = fromLedger;
    this.signer = signer;
    this.keys = keys;
    this.client = client;
    this.engine = new StateEngine({
      client: this.client,
      store: new LocalStorageStore(`privatepay:state:${config.tokenContractId}:`),
      keys,
      address,
      fromLedger,
    });
    this.registerProver = new CircuitProver(registerCircuit as never);
    this.transferProver = new CircuitProver(transferCircuit as never);
  }

  static async connect(
    config: PublicAppConfig,
    session: WalletSession = "holder",
  ): Promise<ConfidentialWallet> {
    const connection = await isConnected();
    if (connection.error) throw new Error(describeError(connection.error));
    if (!connection.isConnected) {
      throw new Error("Freighter was not detected. Install or enable the Freighter extension first.");
    }

    const access = await requestAccess();
    if (access.error) throw new Error(describeError(access.error));
    if (!access.address) throw new Error("Freighter did not return an account address.");

    const network = await getNetwork();
    if (network.error) throw new Error(describeError(network.error));
    if (network.networkPassphrase !== config.networkPassphrase) {
      throw new Error("Switch Freighter to Stellar Testnet, then connect again.");
    }

    ensureBrowserBackend();
    const client = new ChainClient({
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      contracts: {
        token: config.tokenContractId,
        verifier: config.verifierContractId,
        auditor: config.auditorContractId,
      },
    });
    const signer: Signer = {
      publicKey: access.address,
      async sign(transactionXdr: string): Promise<string> {
        const result = await signTransaction(transactionXdr, {
          networkPassphrase: config.networkPassphrase,
          address: access.address,
        });
        if (result.error) throw new Error(describeError(result.error));
        if (result.signerAddress !== access.address) {
          throw new Error(`Freighter signed with ${result.signerAddress}, expected ${access.address}.`);
        }
        return result.signedTxXdr;
      },
    };
    const keys = await deriveWalletKeys(access.address, config);
    const latestLedger = await client.latestLedger();
    const retentionFloor = Math.max(config.deployedAtLedger, latestLedger - 120_000);
    const wallet = new ConfidentialWallet(access.address, config, client, retentionFloor, signer, keys);
    sessionWallets.set(session, wallet);
    return wallet;
  }

  async register(): Promise<string | null> {
    const account = await this.client.confidentialBalance(this.address);
    if (account) {
      if (!account.spendingKey.equals(this.keys.Y) || !account.viewingPublicKey.equals(this.keys.PVK)) {
        throw new Error("This wallet is registered with different confidential keys for this token.");
      }
      return null;
    }

    const witness = buildRegisterWitness(this.keys, this.address);
    const { proof } = await this.registerProver.prove(witness.inputs);
    const result = await withSequenceRetry(() =>
      submitRegister(this.client, this.signer, this.address, this.auditorId, witness, proof),
    );
    await this.engine.sync();
    return result.hash;
  }

  async deposit(amountXlm: string): Promise<string> {
    const amount = amountToStroops(amountXlm);
    const result = await withSequenceRetry(() =>
      submitDeposit(this.client, this.signer, this.address, this.address, amount),
    );
    await this.engine.sync();
    return result.hash;
  }

  async merge(): Promise<string> {
    const result = await withSequenceRetry(() =>
      submitMerge(this.client, this.signer, this.address),
    );
    await this.engine.sync();
    return result.hash;
  }

  async refresh(): Promise<WalletBalance> {
    const account = await this.client.confidentialBalance(this.address);
    if (!account) return { spendable: 0, receiving: 0 };
    const state = await this.engine.sync();
    return {
      spendable: toXlm(state.spendable.v),
      receiving: toXlm(state.receiving.v),
    };
  }

  async receivedPayments(history: PaymentHistoryEntry[]): Promise<ReceivedPayment[]> {
    const account = await this.client.confidentialBalance(this.address);
    if (!account) {
      throw new Error("This Freighter account is not registered on the configured confidential token.");
    }
    if (!account.spendingKey.equals(this.keys.Y) || !account.viewingPublicKey.equals(this.keys.PVK)) {
      throw new Error("This Freighter account is registered with different confidential keys.");
    }

    const recorded = new Map(history.map((payment) => [payment.txHash, payment]));
    if (recorded.size === 0) return [];

    const latestLedger = await this.client.latestLedger();
    const { events } = await fetchEvents(this.client, {
      startLedger: Math.max(this.fromLedger, latestLedger - 120_000),
      contractId: this.client.cfg.contracts.token,
    });

    return events
      .filter((event): event is TransferEvent =>
        event.type === "transfer" && event.to === this.address && recorded.has(event.txHash),
      )
      .map((event) => {
        const record = recorded.get(event.txHash)!;
        const { vTransfer } = this.engine.decryptIncoming(event.rE, event.vTilde, event.sigma);
        return {
          amount: toXlm(vTransfer),
          invoiceNote: record.invoiceNote,
          supplier: this.address,
          txHash: event.txHash,
          timestamp: record.timestamp || `Ledger ${event.ledger}`,
        };
      });
  }

  async pay(recipientAddress: string, amountXlm: string): Promise<string> {
    const amount = amountToStroops(amountXlm);
    const [sender, recipient] = await Promise.all([
      this.client.confidentialBalance(this.address),
      this.client.confidentialBalance(recipientAddress),
    ]);
    if (!sender) throw new Error("Register this wallet with Setup before sending a payment.");
    if (!recipient) throw new Error("The configured supplier is not registered. Run Setup first.");

    await this.engine.sync();
    const { v, r } = await this.engine.spendableForProof();
    if (amount > v) throw new Error(`Insufficient spendable balance. Available: ${toXlm(v)} XLM.`);

    const [recipientAuditorKey, senderAuditorKey] = await Promise.all([
      this.client.auditorKey(recipient.auditorId),
      this.client.auditorKey(sender.auditorId),
    ]);
    const witness = buildTransferWitness({
      keys: this.keys,
      v,
      r,
      amount,
      pvkB: recipient.viewingPublicKey,
      kAudR: recipientAuditorKey,
      kAudS: senderAuditorKey,
    });
    const { proof } = await this.transferProver.prove(witness.inputs);
    const result = await withSequenceRetry(() =>
      submitTransfer(this.client, this.signer, this.address, recipientAddress, witness, proof),
    );
    await this.engine.setSpendable(witness.next);
    return result.hash;
  }
}

export function getConnectedWallet(session: WalletSession = "holder"): ConfidentialWallet | null {
  return sessionWallets.get(session) ?? null;
}
