/**
 * ConfidentialWallet — UI-facing orchestration over stellar-confidential-token-sdk.
 *
 * Holds the RPC client, the Freighter signer, the user's confidential key set,
 * a local state engine, and lazily-created provers. All proving happens in the
 * browser (bb.js); the confidential `sk` never leaves the device. It is
 * derived per the protocol's signer-root rule from a Freighter `signMessage`
 * signature over a token- and account-bound message (see derive-key.ts), and
 * cached in localStorage so the signature prompts only appear once per
 * account + deployment.
 */

import {
  type ChainClient,
  type Signer,
  type OnChainAccount,
  deriveKeys,
  type KeyPair,
  addressToField,
  toHex32,
  fromHex,
  StateEngine,
  StateDivergedError,
  StateUnverifiedError,
  LocalStorageStore,
  freshState,
  type AccountState,
  type Opening,
  type CircuitProver,
  proverFromArtifact,
  buildRegisterWitness,
  buildWithdrawWitness,
  buildTransferWitness,
  submitRegister,
  submitDeposit,
  submitMerge,
  submitWithdraw,
  submitTransfer,
  type IndexerClient,
  hybridFetchEvents,
  proveRecipientDisclosure,
  proveSenderDisclosure,
  senderEphemeralScalar,
  disclosureNonce,
  disclosureOriginator,
  ecdh,
  decryptWithDomain,
  DOMAIN,
  type ConfidentialEvent,
  type DisclosableEvent,
  type DisclosureRequest,
  type DisclosureBundle,
} from "stellar-confidential-token-sdk";
import registerCircuit from "stellar-confidential-token-sdk/circuits/register.json";
import withdrawCircuit from "stellar-confidential-token-sdk/circuits/withdraw.json";
import transferCircuit from "stellar-confidential-token-sdk/circuits/transfer.json";
import discloseRecipientCircuit from "stellar-confidential-token-sdk/circuits/disclosure/disclose_recipient.json";
import discloseSenderCircuit from "stellar-confidential-token-sdk/circuits/disclosure/disclose_sender.json";

import type { Deployment } from "./deployment";
import { connectFreighter } from "./freighter";
import { deriveSignerRootSk } from "./derive-key";
import { ensureBrowserBackend } from "./bb-loader";
import { clientsFor } from "./rpc";
import { stroopsToXlm, truncatePrefix } from "./format";

type Log = (msg: string) => void;
type CircuitName = "register" | "withdraw" | "transfer" | "disclose_recipient" | "disclose_sender";

const CIRCUITS: Record<CircuitName, { bytecode: string } & Record<string, unknown>> = {
  register: registerCircuit as never,
  withdraw: withdrawCircuit as never,
  transfer: transferCircuit as never,
  disclose_recipient: discloseRecipientCircuit as never,
  disclose_sender: discloseSenderCircuit as never,
};

/** Coarse progress of a proof-carrying operation, for UI button labels. */
export type TxPhase = "proving" | "submitting";

/**
 * Whether the local openings re-commit to the on-chain commitments, which
 * `StateEngine.sync()` checks after every replay.
 *
 * - `diverged`: an accumulator doesn't match (a missed or misapplied event).
 *   A diverged spendable opening must not be proven from; a diverged receiving
 *   one must not be merged into spendable.
 * - `unverified`: no balance read lined up with the synced ledger (a busy
 *   account or a lagging RPC node). Nothing is known to be wrong; sync again.
 */
export type StateHealth =
  | { status: "ok" }
  | { status: "diverged"; spendableOk: boolean; receivingOk: boolean }
  | { status: "unverified" };

export interface WalletView {
  address: string;
  registered: boolean;
  spendable: bigint;
  receiving: bigint;
  syncedLedger: number;
  health: StateHealth;
}

export class ConfidentialWallet {
  private provers = new Map<CircuitName, CircuitProver>();
  /** In-flight full-history fetch shared by concurrent callers (see fetchAllEvents). */
  private inFlightEvents: Promise<ConfidentialEvent[]> | null = null;

  private constructor(
    readonly address: string,
    private deployment: Deployment,
    private signer: Signer,
    private keys: KeyPair,
    private client: ChainClient,
    private store: LocalStorageStore,
    private engine: StateEngine,
    private indexer: IndexerClient | undefined,
    private log: Log,
  ) {}

  static async connect(deployment: Deployment, log: Log): Promise<ConfidentialWallet> {
    ensureBrowserBackend();
    const signer = await connectFreighter();
    log(`connected ${signer.publicKey}`);
    log(`deployment: ${deployment.label} (token ${truncatePrefix(deployment.contracts.token, 6)})`);

    const { client, indexer } = clientsFor(deployment);

    // Keys are token-bound (addr_f domain separation), so a different deployment
    // derives a different key set and caches under a different localStorage key.
    const tokenId = deployment.contracts.token;
    const addrF = addressToField(tokenId);
    const skKey = `ctd:sk:${tokenId}:${signer.publicKey}`;
    const onchain = await client.confidentialBalance(signer.publicKey);
    const matchesAccount = (k: KeyPair) => !onchain || onchain.spendingKey.equals(k.Y);

    const stored = localStorage.getItem(skKey);
    let keys = stored ? deriveKeys(fromHex(stored), addrF) : null;
    if (keys && !matchesAccount(keys)) {
      // Cached by an earlier derivation scheme: re-derive rather than strand the account.
      log("cached key does not match the registered account; re-deriving");
      localStorage.removeItem(skKey);
      keys = null;
    }
    if (!keys) {
      keys = deriveKeys(await deriveSignerRootSk(signer, tokenId, log), addrF);
      if (!matchesAccount(keys)) {
        throw new Error(
          "this account is registered on this token under a key Freighter's signature does not derive " +
            "(enrolled by another signer on this address, or by a client with a different derivation), " +
            "so it cannot be operated from here",
        );
      }
      localStorage.setItem(skKey, toHex32(keys.sk));
      log("derived confidential key from wallet signature (cached in localStorage)");
    }

    // Optional Goldsky indexer: when configured, the hybrid event source
    // backfills history older than the RPC's ~7-day window. Without it the app
    // is RPC-only (today's behavior).
    if (indexer) log(`indexer configured (${deployment.indexerUrl})`);

    // State store is namespaced by token address so separate deployments using
    // the same Freighter account don't corrupt each other's balances.
    const store = new LocalStorageStore(`ctd:state:${tokenId}:`);
    const engine = new StateEngine({
      client,
      store,
      keys,
      address: signer.publicKey,
      // Start from the deploy ledger, unclamped: hybridFetchEvents clamps the
      // RPC leg to the retention window and routes anything older to the indexer.
      fromLedger: deployment.deployedAtLedger,
      indexer,
    });

    return new ConfidentialWallet(
      signer.publicKey,
      deployment,
      signer,
      keys,
      client,
      store,
      engine,
      indexer,
      log,
    );
  }

  private prover(name: CircuitName): CircuitProver {
    let p = this.provers.get(name);
    if (!p) {
      // The disclosure circuits prove in the ZK flavour their pinned VKs
      // record; the token circuits must not, or the on-chain verifier rejects.
      p = proverFromArtifact(CIRCUITS[name], { zk: name.startsWith("disclose_") });
      this.provers.set(name, p);
    }
    return p;
  }

  /** Read on-chain account (null if not registered). */
  async account(): Promise<OnChainAccount | null> {
    return this.client.confidentialBalance(this.address);
  }

  async register(onPhase?: (p: TxPhase) => void): Promise<void> {
    const w = buildRegisterWitness(this.keys, this.address);
    onPhase?.("proving");
    this.log("proving register…");
    const { proof } = await this.prover("register").prove(w.inputs);
    onPhase?.("submitting");
    this.log("submitting register…");
    const r = await submitRegister(this.client, this.signer, this.address, this.deployment.auditorId, w, proof);
    this.log(`registered (tx ${truncatePrefix(r.hash)})`);
  }

  async deposit(amount: bigint): Promise<void> {
    this.log(`depositing ${stroopsToXlm(amount)} XLM…`);
    const r = await submitDeposit(this.client, this.signer, this.address, this.address, amount);
    this.log(`deposited (tx ${truncatePrefix(r.hash)}) → receiving balance`);
  }

  async merge(): Promise<void> {
    this.log("merging receiving → spendable…");
    const r = await submitMerge(this.client, this.signer, this.address);
    this.log(`merged (tx ${truncatePrefix(r.hash)})`);
  }

  async transfer(to: string, amount: bigint, onPhase?: (p: TxPhase) => void): Promise<void> {
    const recipient = await this.client.confidentialBalance(to);
    if (!recipient) throw new Error("recipient is not registered");
    const kAudR = await this.client.auditorKey(recipient.auditorId);
    const kAudS = await this.client.auditorKey(this.deployment.auditorId);

    const { v, r: blinding } = await this.spendableForProof();
    if (v < amount) throw new Error(`insufficient spendable balance (${stroopsToXlm(v)} XLM)`);

    const w = buildTransferWitness({
      keys: this.keys,
      v,
      r: blinding,
      amount,
      pvkB: recipient.viewingPublicKey,
      kAudR,
      kAudS,
    });
    onPhase?.("proving");
    this.log("proving transfer…");
    const { proof } = await this.prover("transfer").prove(w.inputs);
    onPhase?.("submitting");
    this.log("submitting transfer…");
    const r = await submitTransfer(this.client, this.signer, this.address, to, w, proof);
    await this.engine.setSpendable(w.next);
    // No r_e bookkeeping (§15.2): the witness derives it from (vk, sigma), so
    // discloseSent() re-derives it from the emitted event whenever needed.
    this.log(`transferred ${stroopsToXlm(amount)} XLM → ${truncatePrefix(to, 6)} (tx ${truncatePrefix(r.hash)})`);
  }

  async withdraw(amount: bigint, onPhase?: (p: TxPhase) => void): Promise<void> {
    const kAudS = await this.client.auditorKey(this.deployment.auditorId);
    const { v, r: blinding } = await this.spendableForProof();
    if (v < amount) throw new Error(`insufficient spendable balance (${stroopsToXlm(v)} XLM)`);

    const w = buildWithdrawWitness({ keys: this.keys, v, r: blinding, amount, kAudS });
    onPhase?.("proving");
    this.log("proving withdraw…");
    const { proof } = await this.prover("withdraw").prove(w.inputs);
    onPhase?.("submitting");
    this.log("submitting withdraw…");
    const r = await submitWithdraw(this.client, this.signer, this.address, this.address, amount, w, proof);
    await this.engine.setSpendable(w.next);
    this.log(`withdrew ${stroopsToXlm(amount)} XLM → public (tx ${truncatePrefix(r.hash)})`);
  }

  /**
   * Sync, then the spendable opening to prove from, re-checked against the
   * chain. A receiving-side divergence does not block it: withdraw and transfer
   * open `C_spend` alone.
   */
  private async spendableForProof(): Promise<Opening> {
    try {
      await this.engine.sync();
    } catch (e) {
      if (!(e instanceof StateDivergedError && e.report.spendableOk)) throw e;
    }
    return this.engine.spendableForProof();
  }

  /**
   * This account's token-contract events, newest first. With an indexer
   * configured this spans the full history; otherwise it is limited to the
   * RPC's ~7-day retention window.
   */
  async listEvents(): Promise<ConfidentialEvent[]> {
    const events = await this.fetchAllEvents();
    return events.filter((ev) => this.concernsMe(ev)).reverse();
  }

  /**
   * Other accounts with a `register` event — the way to enumerate possible
   * transfer recipients. With an indexer this covers the full history; without
   * one, an account registered more than ~7 days ago won't appear.
   */
  async registeredRecipients(): Promise<string[]> {
    const seen = new Set<string>();
    for (const ev of await this.fetchAllEvents()) {
      if (ev.type === "register" && ev.account !== this.address) seen.add(ev.account);
    }
    return [...seen];
  }

  /**
   * Full token-event history (indexer + RPC), the source for both the activity
   * list and recipient discovery.
   *
   * Single-flight: `listEvents()` and `registeredRecipients()` both run a
   * full-history scan and fire near-simultaneously on connect. Concurrent
   * callers share ONE in-flight fetch; the moment it settles the slot is
   * cleared, so any LATER call (the activity panel's Reload, a post-tx refresh,
   * the recipients refresh button) re-fetches and picks up new events —
   * including ones from other accounts. This only de-duplicates overlapping
   * requests; it never serves stale data, so there is no cache to invalidate.
   */
  private async fetchAllEvents(): Promise<ConfidentialEvent[]> {
    if (this.inFlightEvents) return this.inFlightEvents;
    const fetch = hybridFetchEvents(this.client, this.indexer, {
      fromLedger: this.deployment.deployedAtLedger,
    }).then((r) => r.events);
    this.inFlightEvents = fetch;
    try {
      return await fetch;
    } finally {
      this.inFlightEvents = null;
    }
  }

  private concernsMe(ev: ConfidentialEvent): boolean {
    const me = this.address;
    switch (ev.type) {
      case "register":
      case "merge":
      case "clawback":
        return ev.account === me;
      case "set_spender":
      case "revoke_spender":
        return ev.account === me || ev.spender === me;
      case "deposit":
      case "withdraw":
      case "transfer":
        return ev.from === me || ev.to === me;
      case "spender_transfer":
        return ev.from === me || ev.to === me || ev.spender === me;
      default:
        // Compliance/policy membership events are surfaced in the admin
        // dashboard, not the wallet activity list.
        return false;
    }
  }

  // ---- selective disclosure (SELECTIVE_DISCLOSURE.md §12, holder side) -----

  /**
   * The ephemeral scalar of a payment this wallet originated:
   * `r_e = Poseidon2(EPHEMERAL_KEY, vk, σ_E)`, checked against the event's
   * `R_e`. No per-transfer state — `σ_E` is public in the event. `null` means
   * this wallet did not originate it (the originator of a spender transfer is
   * the spender, not the owner), or not with these keys.
   */
  private originatedScalar(event: DisclosableEvent): bigint | null {
    if (disclosureOriginator(event).account !== this.address) return null;
    return senderEphemeralScalar(this.keys, { rE: event.rE, sigma: disclosureNonce(event) });
  }

  /** True iff this wallet can produce the ephemeral scalar for an outgoing payment. */
  canDiscloseSent(event: DisclosableEvent): boolean {
    return this.originatedScalar(event) !== null;
  }

  /**
   * Decrypt a confidential payment's amount for local display, from whichever
   * side this wallet is on:
   *   - inbound (to === me):  ECDH with this wallet's viewing key.
   *   - originated by me: re-derive the ephemeral scalar (§15.2) and ECDH
   *     against the recipient's stored viewing key — the same recovery as
   *     discloseSent, minus the proof.
   * Returns null when the amount can't be recovered here: the owner's side of
   * a spender transfer, a payment not built with these keys, or a recipient
   * with no on-chain account record. The amount stays confidential on-chain
   * regardless.
   */
  async transferAmount(event: DisclosableEvent): Promise<bigint | null> {
    const sigma = disclosureNonce(event);
    // Inbound path also covers a self-transfer (to === from === me).
    if (event.to === this.address) {
      return this.engine.decryptIncoming(event.rE, event.vTilde, sigma).vTransfer;
    }
    const rEScalar = this.originatedScalar(event);
    if (rEScalar === null) return null;
    const recipient = await this.client.confidentialBalance(event.to);
    if (!recipient) return null;
    const s = ecdh(rEScalar, recipient.viewingPublicKey);
    const vTransfer = decryptWithDomain(event.vTilde, DOMAIN.TRANSFER_AMOUNT, s, sigma);
    // A wrong key yields garbage far outside the 127-bit amount range.
    if (vTransfer >= 1n << 127n) return null;
    return vTransfer;
  }

  /**
   * Produce a D-recipient disclosure bundle for an inbound payment event,
   * answering a third party's `(P_R, ν)` request. Runs the disclosure circuit
   * in-browser; only works for events whose `to` is this wallet.
   */
  async discloseReceived(event: DisclosableEvent, request: DisclosureRequest): Promise<DisclosureBundle> {
    if (event.to !== this.address) {
      throw new Error("D-recipient disclosure only works for payments addressed to this wallet");
    }
    this.log("proving disclosure (D-recipient)…");
    const bundle = await proveRecipientDisclosure({
      keys: this.keys,
      event,
      request,
      prover: this.prover("disclose_recipient"),
    });
    this.log(`disclosure proof ready for event in tx ${truncatePrefix(event.txHash)}`);
    return bundle;
  }

  /**
   * Produce a D-sender disclosure bundle for a payment this wallet originated.
   * The SDK re-derives the ephemeral scalar from `vk` + the event's public
   * `σ_E` (deterministic r_e) — no per-transfer state (§7).
   */
  async discloseSent(event: DisclosableEvent, request: DisclosureRequest): Promise<DisclosureBundle> {
    if (disclosureOriginator(event).account !== this.address) {
      throw new Error(
        event.type === "spender_transfer"
          ? "only the spender can D-sender a spender transfer, not the owner"
          : "D-sender disclosure only works for transfers sent by this wallet",
      );
    }
    const recipient = await this.client.confidentialBalance(event.to);
    if (!recipient) throw new Error("transfer recipient has no confidential account record");
    this.log("proving disclosure (D-sender)…");
    const outcome = await proveSenderDisclosure({
      keys: this.keys,
      event,
      pvkB: recipient.viewingPublicKey,
      request,
      prover: this.prover("disclose_sender"),
    });
    if (!outcome.disclosable) {
      throw new Error(
        `this payment can't be D-sender disclosed from this wallet (${outcome.reason}): its R_e doesn't match the ephemeral scalar these keys derive, so it wasn't sent with them`,
      );
    }
    this.log(`disclosure proof ready for event in tx ${truncatePrefix(event.txHash)}`);
    return outcome.bundle;
  }

  /** Free every cached bb.js prover (worker + WASM) before discarding this wallet. */
  async destroy(): Promise<void> {
    await Promise.all([...this.provers.values()].map((p) => p.destroy()));
    this.provers.clear();
  }

  /**
   * Sync from events and return a UI view. `sync()` ends in the consistency
   * check; a divergence or an unverifiable read is reported in `health`, with
   * balances from the saved state, rather than thrown.
   */
  async refresh(): Promise<WalletView> {
    let state: AccountState;
    let health: StateHealth;
    try {
      state = await this.engine.sync();
      health = { status: "ok" };
    } catch (e) {
      if (e instanceof StateDivergedError) {
        // Never log the error's `state`: it holds the secret openings.
        health = { status: "diverged", spendableOk: e.report.spendableOk, receivingOk: e.report.receivingOk };
      } else if (e instanceof StateUnverifiedError) {
        health = { status: "unverified" };
      } else {
        throw e;
      }
      state = await this.engine.current();
    }
    const onchain = await this.account();
    return {
      address: this.address,
      registered: onchain !== null,
      spendable: state.spendable.v,
      receiving: state.receiving.v,
      syncedLedger: state.syncedLedger,
      health,
    };
  }

  /**
   * Drop the saved openings and cursor so the next sync replays the token's
   * whole history from its deploy ledger. Without an indexer, events older than
   * the RPC's retention window are gone, and so is anything they credited.
   */
  async rebuildFromHistory(): Promise<void> {
    this.log("cleared local state; replaying from the deploy ledger…");
    await this.store.save(freshState(this.address));
  }
}
