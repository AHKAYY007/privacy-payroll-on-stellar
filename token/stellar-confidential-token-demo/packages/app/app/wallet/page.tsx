"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfidentialWallet, type StateHealth, type WalletView, type TxPhase } from "@/lib/wallet";
import { useActiveDeployment } from "@/lib/active-deployment";
import { errMsg } from "@/lib/err";
import { stroopsToXlm, xlmToStroops } from "@/lib/format";
import { useLog } from "@/lib/use-log";
import { EventsPanel } from "./events-panel";
import { PageShell } from "../page-shell";
import { ErrorBox } from "../error-box";
import { LogPanel } from "../log-panel";
import { Addr } from "../addr";

type ActionTab = "deposit" | "withdraw" | "transfer" | "merge";

// Per-action visual identity. Colors match the activity-panel badges
// (deposit = sky, withdraw = amber); classes are literal so Tailwind sees them.
const ACTIONS: Record<
  ActionTab,
  { icon: string; title: string; hint: string; card: string; panel: string; btn: string }
> = {
  deposit: {
    icon: "↓",
    title: "Deposit",
    hint: "Public XLM → your receiving balance.",
    card: "border-sky-500/60 bg-sky-500/15 text-sky-300",
    panel: "border-sky-500/30 bg-sky-500/5",
    btn: "bg-sky-600 hover:bg-sky-500",
  },
  withdraw: {
    icon: "↑",
    title: "Withdraw",
    hint: "Spendable → public XLM (to yourself).",
    card: "border-amber-500/60 bg-amber-500/15 text-amber-300",
    panel: "border-amber-500/30 bg-amber-500/5",
    btn: "bg-amber-600 hover:bg-amber-500",
  },
  transfer: {
    icon: "→",
    title: "Transfer",
    hint: "Send to another registered account's receiving balance — amount stays private.",
    card: "border-violet-500/60 bg-violet-500/15 text-violet-300",
    panel: "border-violet-500/30 bg-violet-500/5",
    btn: "bg-violet-600 hover:bg-violet-500",
  },
  merge: {
    icon: "⊕",
    title: "Merge",
    hint: "Fold your receiving balance into spendable.",
    card: "border-emerald-500/60 bg-emerald-500/15 text-emerald-300",
    panel: "border-emerald-500/30 bg-emerald-500/5",
    btn: "bg-emerald-600 hover:bg-emerald-500",
  },
};

export default function Page() {
  const { active, which, staleSweep, dismissStaleSweep, droppedAdvanced } = useActiveDeployment();
  const [wallet, setWallet] = useState<ConfidentialWallet | null>(null);
  const [view, setView] = useState<WalletView | null>(null);
  const [logs, log] = useLog(60);
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<TxPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ActionTab>("deposit");
  const [recipients, setRecipients] = useState<string[] | null>(null);
  const [mergeNotice, setMergeNotice] = useState<"incoming" | "deposit" | null>(null);
  const [eventsKey, setEventsKey] = useState(0);

  const [depositAmt, setDepositAmt] = useState("100");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmt, setTransferAmt] = useState("40");
  const [withdrawAmt, setWithdrawAmt] = useState("40");

  const loadRecipients = useCallback(
    async (w: ConfidentialWallet) => {
      try {
        setRecipients(await w.registeredRecipients());
      } catch (e) {
        log(`failed to list registered accounts: ${errMsg(e)}`);
        setRecipients([]);
      }
    },
    [log],
  );

  const connect = useCallback(async () => {
    setError(null);
    setBusy("connecting");
    try {
      const w = await ConfidentialWallet.connect(active, log);
      setWallet(w);
      const v = await w.refresh();
      setView(v);
      if (v.receiving > 0n) setMergeNotice("incoming");
      void loadRecipients(w);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }, [active, log, loadRecipients]);

  // Switching deployment invalidates the connected wallet (different token →
  // different keys, balances, and event history). Reset so the user reconnects
  // against the newly-active deployment, freeing the old wallet's cached bb.js
  // provers (workers/WASM) first.
  useEffect(() => {
    setWallet((prev) => {
      void prev?.destroy();
      return null;
    });
    setView(null);
    setRecipients(null);
    setMergeNotice(null);
    setError(null);
  }, [active.contracts.token]);

  const run = useCallback(
    (label: string, fn: (w: ConfidentialWallet) => Promise<void>) => async () => {
      if (!wallet) return;
      setError(null);
      setBusy(label);
      setPhase(null);
      try {
        await fn(wallet);
        const v = await wallet.refresh();
        setView(v);
        if (v.receiving === 0n) setMergeNotice(null);
        else if (label === "deposit") setMergeNotice("deposit");
        if (label !== "refresh") setEventsKey((k) => k + 1);
      } catch (e) {
        setError(errMsg(e));
        log(`error: ${errMsg(e)}`);
      } finally {
        setBusy(null);
        setPhase(null);
      }
    },
    [wallet, log],
  );

  // A diverged spendable opening can't be proven from (withdraw, transfer); a
  // diverged receiving one must not be folded into spendable (merge).
  const diverged = view?.health.status === "diverged" ? view.health : null;
  const blocked: Partial<Record<ActionTab, string>> = diverged
    ? {
        ...(!diverged.spendableOk && {
          withdraw: "Your spendable balance doesn't match the chain, so no proof can be built from it.",
          transfer: "Your spendable balance doesn't match the chain, so no proof can be built from it.",
        }),
        merge: "Merging would fold the mismatched balance into the other one.",
      }
    : {};

  const showMerge = (view?.receiving ?? 0n) > 0n;
  const activeTab: ActionTab = tab === "merge" && !showMerge ? "deposit" : tab;
  const tabs: ActionTab[] = showMerge
    ? ["deposit", "withdraw", "transfer", "merge"]
    : ["deposit", "withdraw", "transfer"];

  return (
    <PageShell
      title="Account holder"
      subtitle="Hold tokens and move them without revealing amounts on-chain: deposit, merge, transfer, and withdraw, each as a client-side zero-knowledge proof. To prove what a single transfer paid, disclose it from the activity list below."
    >
      {error && <ErrorBox className="mb-6">{error}</ErrorBox>}

      {/* Only in easy mode: in advanced mode the user is not on the default
          token, so a default redeploy is not what reset their view. */}
      {which === "default" && (staleSweep || droppedAdvanced) && (
        <div className="mb-6 flex items-start justify-between gap-3 rounded border border-sky-700 bg-sky-950/40 p-3 text-sm text-sky-200">
          <div>
            {staleSweep && (
              <>
                <p className="font-medium">
                  {staleSweep.reason === "redeployed"
                    ? "A new default confidential token has been deployed."
                    : "Cleared cached keys from a token this demo no longer serves."}
                </p>
                <p className="mt-1 text-sky-300/90">
                  Confidential keys are bound to the token contract, so nothing carries over from the
                  previous one — your cached keys and balances for it have been cleared. Connect and
                  register again to start from a blank account.
                </p>
              </>
            )}
            {droppedAdvanced && (
              <p className="mt-1 text-sky-300/90">
                The token you deployed in advanced mode came from an earlier release&apos;s factory,
                which this app can no longer read, so it has been removed. Deploy a new one from
                Advanced mode.
              </p>
            )}
          </div>
          <button
            onClick={dismissStaleSweep}
            className="shrink-0 rounded px-2 py-1 text-sky-400 hover:text-sky-200"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {!wallet ? (
        <button
          onClick={connect}
          disabled={busy !== null}
          className="rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy === "connecting" ? "Connecting…" : "Connect Freighter"}
        </button>
      ) : (
        <div className="space-y-6">
          <Balances view={view} />

          {view?.registered && view.health.status !== "ok" && (
            <HealthNotice
              view={view}
              busy={busy !== null}
              hasIndexer={!!active.indexerUrl}
              onResync={run("refresh", async () => {})}
              onRebuild={run("rebuild", (w) => w.rebuildFromHistory())}
            />
          )}

          {view?.registered && mergeNotice && showMerge && (
            <div className="flex items-center justify-between gap-3 rounded border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-300">
              <span>
                {mergeNotice === "deposit"
                  ? `Deposit landed in your receiving balance (${stroopsToXlm(view.receiving)} XLM). Merge it before you can transfer or withdraw.`
                  : `You have an incoming balance of ${stroopsToXlm(view.receiving)} XLM. Merge it to make it spendable.`}
              </span>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => setTab("merge")}
                  className="rounded bg-amber-700 px-3 py-1 font-medium text-amber-100 hover:bg-amber-600"
                >
                  Go to merge
                </button>
                <button
                  onClick={() => setMergeNotice(null)}
                  className="rounded px-2 py-1 text-amber-400 hover:text-amber-200"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {!view?.registered ? (
            <section className="rounded border border-neutral-800 p-4">
              <h3 className="font-medium">Register</h3>
              <p className="mb-3 mt-0.5 text-xs text-neutral-400">
                Bind your confidential keys to the contract (one-time). All other actions unlock
                once you&apos;re registered.
              </p>
              <p className="mb-3 text-xs text-neutral-500">
                Your confidential key is derived from your Freighter account&apos;s signature, so this
                account stays confidential only as long as that account&apos;s signing key stays secret.
                Anyone holding it can read and spend your confidential balance, and the confidential
                key cannot be rotated: recovering from a leak means registering a new address and
                transferring the funds to it.
              </p>
              <button
                onClick={run("register", (w) => w.register(setPhase))}
                disabled={busy !== null}
                className="rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
              >
                {busy === "register" ? phaseLabel(phase) : "Register"}
              </button>
            </section>
          ) : (
            <section className="rounded border border-neutral-800">
              <div className="flex gap-2 border-b border-neutral-800 bg-neutral-900/40 p-3">
                {tabs.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`relative flex flex-1 flex-col items-center gap-1 rounded-md border py-2.5 text-sm font-medium transition-colors ${
                      activeTab === t
                        ? ACTIONS[t].card
                        : "border-neutral-800 bg-neutral-900/60 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300"
                    }`}
                  >
                    <span aria-hidden className="text-lg leading-none">
                      {ACTIONS[t].icon}
                    </span>
                    {ACTIONS[t].title}
                    {t === "merge" && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-emerald-500/20 px-1.5 text-[10px] leading-4 text-emerald-300">
                        {stroopsToXlm(view.receiving)}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {activeTab === "deposit" && (
                  <ActionPanel action="deposit">
                    <AmountInput value={depositAmt} onChange={setDepositAmt} className="sm:w-36" />
                    <button
                      onClick={run("deposit", (w) => w.deposit(xlmToStroops(depositAmt)))}
                      disabled={busy !== null}
                      className={`${btnCls} ${ACTIONS.deposit.btn}`}
                    >
                      {busy === "deposit" ? "Submitting tx…" : "Deposit"}
                    </button>
                  </ActionPanel>
                )}

                {activeTab === "withdraw" && (
                  <ActionPanel action="withdraw">
                    <AmountInput value={withdrawAmt} onChange={setWithdrawAmt} className="sm:w-36" />
                    <button
                      onClick={run("withdraw", (w) => w.withdraw(xlmToStroops(withdrawAmt), setPhase))}
                      disabled={busy !== null || !!blocked.withdraw}
                      title={blocked.withdraw}
                      className={`${btnCls} ${ACTIONS.withdraw.btn}`}
                    >
                      {busy === "withdraw" ? phaseLabel(phase) : "Withdraw"}
                    </button>
                  </ActionPanel>
                )}

                {activeTab === "transfer" && (
                  <ActionPanel action="transfer">
                    <RecipientSelect
                      recipients={recipients}
                      value={transferTo}
                      onChange={setTransferTo}
                    />
                    <AmountInput value={transferAmt} onChange={setTransferAmt} className="sm:w-28" />
                    <button
                      onClick={run("transfer", (w) => w.transfer(transferTo, xlmToStroops(transferAmt), setPhase))}
                      disabled={busy !== null || !transferTo || !!blocked.transfer}
                      title={blocked.transfer}
                      className={`${btnCls} ${ACTIONS.transfer.btn}`}
                    >
                      {busy === "transfer" ? phaseLabel(phase) : "Send"}
                    </button>
                  </ActionPanel>
                )}

                {activeTab === "merge" && (
                  <ActionPanel action="merge">
                    <button
                      onClick={run("merge", (w) => w.merge())}
                      disabled={busy !== null || !!blocked.merge}
                      title={blocked.merge}
                      className={`${btnCls} ${ACTIONS.merge.btn}`}
                    >
                      {busy === "merge" ? "Submitting tx…" : `Merge ${stroopsToXlm(view.receiving)} XLM`}
                    </button>
                  </ActionPanel>
                )}
              </div>
            </section>
          )}

          <EventsPanel wallet={wallet} reloadKey={eventsKey} />

          <button
            onClick={run("refresh", async (w) => {
              void loadRecipients(w);
            })}
            disabled={busy !== null}
            className="text-sm text-neutral-400 underline hover:text-neutral-200 disabled:opacity-50"
          >
            {busy === "refresh"
              ? "Syncing…"
              : active.indexerUrl
                ? "Sync events (RPC + indexer)"
                : "Sync from RPC events"}
          </button>
        </div>
      )}

      <LogPanel logs={logs} />
    </PageShell>
  );
}

const inputCls =
  "rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-indigo-500";
const btnCls = "rounded px-4 py-2 text-sm font-medium disabled:opacity-50";

function phaseLabel(phase: TxPhase | null): string {
  if (phase === "submitting") return "Submitting tx…";
  if (phase === "proving") return "Proving…";
  return "Preparing…";
}

function RecipientSelect(props: {
  recipients: string[] | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const { recipients, value, onChange } = props;
  const empty = recipients !== null && recipients.length === 0;
  return (
    <select
      className={`${inputCls} min-w-0 flex-1`}
      value={empty ? "" : value}
      onChange={(e) => onChange(e.target.value)}
    >
      {recipients === null ? (
        <option value="">Loading registered accounts…</option>
      ) : empty ? (
        <option value="">
          No other registered accounts yet — switch your Freighter account to load another
          address, register it, then refresh this page
        </option>
      ) : (
        <>
          <option value="">Select recipient…</option>
          {recipients.map((a) => (
            <option key={a} value={a}>
              {`${a.slice(0, 12)}…${a.slice(-12)}`}
            </option>
          ))}
        </>
      )}
    </select>
  );
}

function ActionPanel(props: { action: ActionTab; children: React.ReactNode }) {
  const meta = ACTIONS[props.action];
  return (
    <div className={`rounded-md border p-4 ${meta.panel}`}>
      <p className="mb-3 text-xs text-neutral-400">{meta.hint}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">{props.children}</div>
    </div>
  );
}

const HEALTH_BADGE: Record<StateHealth["status"], { text: string; cls: string }> = {
  ok: { text: "state matches chain ✓", cls: "bg-emerald-900 text-emerald-300" },
  diverged: { text: "state mismatch ✗", cls: "bg-red-900 text-red-300" },
  unverified: { text: "not verified yet", cls: "bg-amber-900 text-amber-300" },
};

function Balances({ view }: { view: WalletView | null }) {
  if (!view) return null;
  const badge = HEALTH_BADGE[view.health.status];
  const diverged = view.health.status === "diverged" ? view.health : null;
  return (
    <section className="rounded border border-neutral-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <Addr value={view.address} full className="text-sm text-neutral-400" />
        {view.registered && (
          <span
            className={`rounded px-2 py-0.5 text-xs ${badge.cls}`}
            title="Local reconstruction re-committed and compared to on-chain commitments"
          >
            {badge.text}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Spendable" value={stroopsToXlm(view.spendable)} wrong={diverged?.spendableOk === false} />
        <Stat label="Receiving" value={stroopsToXlm(view.receiving)} wrong={diverged?.receivingOk === false} />
      </div>
      <p className="mt-3 text-xs text-neutral-500">
        {view.registered ? `synced through ledger ${view.syncedLedger}` : "not registered yet"}
      </p>
    </section>
  );
}

function Stat({ label, value, wrong = false }: { label: string; value: string; wrong?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        {label}
        {wrong && <span className="ml-2 normal-case tracking-normal text-red-400">doesn&apos;t match chain</span>}
      </div>
      <div className={`text-2xl ${wrong ? "text-neutral-500 line-through" : ""}`}>
        {value} <span className="text-sm text-neutral-500">XLM</span>
      </div>
    </div>
  );
}

/**
 * Explains a failed consistency check and offers the matching recovery. A
 * divergence is a missed or misapplied event, so the fix is a full replay; an
 * unverified read is usually a lagging RPC node, so the fix is to sync again.
 */
function HealthNotice(props: {
  view: WalletView;
  busy: boolean;
  hasIndexer: boolean;
  onResync: () => void;
  onRebuild: () => void;
}) {
  const { view, busy, hasIndexer, onResync, onRebuild } = props;
  if (view.health.status === "unverified") {
    return (
      <div className="flex items-center justify-between gap-3 rounded border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-300">
        <span>
          Couldn&apos;t confirm your balances against the chain: the RPC answered for a different
          ledger than the events were synced to. This usually clears on the next sync.
        </span>
        <button
          onClick={onResync}
          disabled={busy}
          className="shrink-0 rounded bg-amber-700 px-3 py-1 font-medium text-amber-100 hover:bg-amber-600 disabled:opacity-50"
        >
          Sync again
        </button>
      </div>
    );
  }
  if (view.health.status !== "diverged") return null;
  const { spendableOk, receivingOk } = view.health;
  const which = [!spendableOk && "spendable", !receivingOk && "receiving"].filter(Boolean).join(" and ");
  return (
    <div className="space-y-2 rounded border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
      <p>
        Your locally reconstructed {which} balance doesn&apos;t match its on-chain commitment, so an
        event was missed or misapplied.{" "}
        {spendableOk
          ? "Withdraw and transfer still work, since they only use your spendable balance; merge is blocked."
          : "Withdraw, transfer and merge are blocked until it's repaired."}
      </p>
      <p className="text-red-300/80">
        Rebuilding clears this browser&apos;s saved balances and replays the token&apos;s history
        from its deployment.
        {!hasIndexer &&
          " Without an indexer only the RPC's last ~7 days can be replayed, so anything credited before that is lost."}
      </p>
      <button
        onClick={onRebuild}
        disabled={busy}
        className="rounded bg-red-800 px-3 py-1 font-medium text-red-100 hover:bg-red-700 disabled:opacity-50"
      >
        Rebuild from history
      </button>
    </div>
  );
}

/** XLM amount field: a numeric text input with a trailing "XLM" unit chip. */
function AmountInput({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <input
        className={`${inputCls} w-full pr-12`}
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-neutral-500">
        XLM
      </span>
    </div>
  );
}

