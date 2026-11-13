"use client";

/**
 * Auditor console (DESIGN.md §8). The auditor persona holds the Grumpkin
 * secret behind auditor id 0 — the id every account in this demo registers
 * under — and decrypts the dual-channel ciphertexts that each transfer and
 * withdraw event carries. Pure key-and-events work: no wallet, no proving,
 * no holder cooperation.
 *
 * Beyond per-event amounts, the page replays the event stream into the
 * auditor's running view of every account (§8.1/§8.2): spendable balance from
 * the sender-channel checkpoints, receiving balance as the sum of decrypted
 * inbound transfers plus public deposits, folded on merge and clawback, and
 * each delegation's escrowed allowance, from set_spender to the spender
 * transfers that draw on it and the revoke that returns it.
 *
 * ⚠️ The secret key is shipped in the client bundle ON PURPOSE so anyone can
 * play this persona. Real deployments keep it far away from a browser.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  hybridFetchEvents,
  auditSetSpender,
  auditSpenderTransfer,
  auditTransfer,
  auditWithdraw,
  auditorPublicKey,
  pointCoords,
  toHex32,
  fromHex,
  type ConfidentialEvent,
} from "stellar-confidential-token-sdk";
import { useActiveDeployment } from "@/lib/active-deployment";
import { clientsFor } from "@/lib/rpc";
import { errMsg } from "@/lib/err";
import { stroopsToXlm } from "@/lib/format";
import { CopyButton } from "../copy-button";
import { PageShell } from "../page-shell";
import { ErrorBox } from "../error-box";
import { Addr } from "../addr";
import { TxLink } from "../tx-link";

/** One decrypted line of the auditor's ledger. */
interface AuditRow {
  ev: ConfidentialEvent;
  text: string;
  /** Decrypted (or public) amount, when the event has one. */
  amount: bigint | null;
  /** Sender's post-op spendable balance, when the event reveals one. */
  senderBalance: bigint | null;
  /** False iff a transfer's two channels decrypt to different amounts. */
  channelsAgree: boolean;
}

/** The auditor's running view of one account (§8.1). */
interface AccountView {
  address: string;
  /** Last sender-channel checkpoint (null = not known from the events seen). */
  spendable: bigint | null;
  /** Running sum of decrypted inbound transfers + public deposits. */
  receiving: bigint;
  /**
   * Allowances escrowed with spenders, as of the last set_spender or spender
   * transfer seen for each delegation.
   */
  escrowed: bigint;
  lastLedger: number;
}

function replay(
  events: ConfidentialEvent[],
  auditorSk: bigint,
): { rows: AuditRow[]; accounts: AccountView[] } {
  const rows: AuditRow[] = [];
  const accounts = new Map<string, AccountView>();
  // Escrowed allowance per (owner, spender), from the owner-auditor channels.
  // A missing key means the delegation's set_spender wasn't seen.
  const allowances = new Map<string, bigint>();
  const delegation = (owner: string, spender: string) => `${owner}:${spender}`;
  const acct = (address: string): AccountView => {
    let a = accounts.get(address);
    if (!a) {
      a = { address, spendable: null, receiving: 0n, escrowed: 0n, lastLedger: 0 };
      accounts.set(address, a);
    }
    return a;
  };
  const row = (ev: ConfidentialEvent, text: string, extra: Partial<AuditRow> = {}) =>
    rows.push({ ev, text, amount: null, senderBalance: null, channelsAgree: true, ...extra });
  const seen = (address: string, ledger: number) => {
    const a = acct(address);
    a.lastLedger = Math.max(a.lastLedger, ledger);
    return a;
  };

  for (const ev of events) {
    switch (ev.type) {
      case "register": {
        const a = seen(ev.account, ev.ledger);
        a.spendable = 0n;
        rows.push({ ev, text: "registered", amount: null, senderBalance: null, channelsAgree: true });
        break;
      }
      case "deposit": {
        const a = seen(ev.to, ev.ledger);
        a.receiving += ev.amount;
        rows.push({
          ev,
          text: "deposit (public amount)",
          amount: ev.amount,
          senderBalance: null,
          channelsAgree: true,
        });
        break;
      }
      case "merge": {
        const a = seen(ev.account, ev.ledger);
        if (a.spendable !== null) a.spendable += a.receiving;
        a.receiving = 0n;
        rows.push({
          ev,
          text: "merged receiving → spendable",
          amount: null,
          senderBalance: a.spendable,
          channelsAgree: true,
        });
        break;
      }
      case "withdraw": {
        const a = seen(ev.from, ev.ledger);
        const { senderBalance } = auditWithdraw(auditorSk, ev);
        a.spendable = senderBalance;
        rows.push({
          ev,
          text: "withdrawal (public amount) — checkpoint decrypted",
          amount: ev.amount,
          senderBalance,
          channelsAgree: true,
        });
        break;
      }
      case "transfer": {
        const from = seen(ev.from, ev.ledger);
        const to = seen(ev.to, ev.ledger);
        const d = auditTransfer(auditorSk, ev);
        if (d.channelsAgree) {
          from.spendable = d.senderBalance;
          to.receiving += d.amount;
        }
        rows.push({
          ev,
          text: d.channelsAgree
            ? "confidential transfer — both channels decrypted"
            : "transfer did NOT decrypt under this key",
          amount: d.channelsAgree ? d.amount : null,
          senderBalance: d.channelsAgree ? d.senderBalance : null,
          channelsAgree: d.channelsAgree,
        });
        break;
      }
      case "set_spender": {
        // The owner's auditor sees the escrowed amount and the owner's new
        // spendable checkpoint, like a transfer's sender channel.
        const a = seen(ev.account, ev.ledger);
        seen(ev.spender, ev.ledger);
        const d = auditSetSpender(auditorSk, ev);
        a.spendable = d.senderBalance;
        allowances.set(delegation(ev.account, ev.spender), d.amount);
        row(ev, `allowance escrowed for spender, live until ledger ${ev.liveUntilLedger}`, {
          amount: d.amount,
          senderBalance: d.senderBalance,
        });
        break;
      }
      case "spender_transfer": {
        // Paid out of the owner's allowance; the owner's spendable is untouched.
        const to = seen(ev.to, ev.ledger);
        seen(ev.from, ev.ledger);
        seen(ev.spender, ev.ledger);
        const d = auditSpenderTransfer(auditorSk, ev);
        if (d.channelsAgree) {
          to.receiving += d.amount;
          allowances.set(delegation(ev.from, ev.spender), d.allowance);
        }
        row(
          ev,
          d.channelsAgree
            ? `spender transfer — both channels decrypted; ${stroopsToXlm(d.allowance)} XLM left in the allowance`
            : "spender transfer did NOT decrypt under this key",
          { amount: d.channelsAgree ? d.amount : null, channelsAgree: d.channelsAgree },
        );
        break;
      }
      case "revoke_spender": {
        // C_spend += C_a: the remaining allowance folds back into spendable.
        const a = seen(ev.account, ev.ledger);
        const key = delegation(ev.account, ev.spender);
        const left = allowances.get(key);
        a.spendable = a.spendable !== null && left !== undefined ? a.spendable + left : null;
        allowances.delete(key);
        row(ev, "allowance returned to the owner's spendable balance", {
          amount: left ?? null,
          senderBalance: a.spendable,
        });
        break;
      }
      case "clawback": {
        // C_spend' = C_spend + C_receive − amount·G; C_receive' = O.
        const a = seen(ev.account, ev.ledger);
        a.spendable = a.spendable !== null ? a.spendable + a.receiving - ev.amount : null;
        a.receiving = 0n;
        row(ev, `clawback (public amount)${ev.destination ? "" : ", left in the pool"}`, {
          amount: ev.amount,
          senderBalance: a.spendable,
        });
        break;
      }
      case "frozen":
      case "unfrozen":
        seen(ev.account, ev.ledger);
        row(ev, ev.type === "frozen" ? "account frozen by the token's freezer" : "account unfrozen");
        break;
      case "compliance_config_changed":
        row(
          ev,
          `compliance config: policy ${ev.policy ?? "none"}, sac_passthrough ${String(ev.sacPassthrough)}`,
        );
        break;
    }
  }

  for (const [key, v] of allowances) acct(key.split(":")[0]!).escrowed += v;

  return {
    rows: rows.reverse(),
    accounts: [...accounts.values()].sort((a, b) => b.lastLedger - a.lastLedger),
  };
}

export default function AuditorPage() {
  const { active } = useActiveDeployment();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The auditor key is constant across deployments (same auditor contract), but
  // the token whose events we decrypt follows the active deployment.
  const auditorSk = useMemo(() => fromHex(active.auditorSecretHex), [active.auditorSecretHex]);
  const kAud = useMemo(() => pointCoords(auditorPublicKey(auditorSk)), [auditorSk]);
  const hasIndexer = !!active.indexerUrl;
  const anyEscrow = accounts.some((a) => a.escrowed !== 0n);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Hybrid source: the indexer (when configured) backfills the full history
      // below the RPC's ~7-day window — exactly what an auditor needs. The RPC
      // leg is clamped to the retention boundary internally.
      const { client, indexer } = clientsFor(active);
      const { events } = await hybridFetchEvents(client, indexer, {
        fromLedger: active.deployedAtLedger,
      });
      const result = replay(events, auditorSk);
      setRows(result.rows);
      setAccounts(result.accounts);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [active, auditorSk]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageShell
      title="Auditor"
      subtitle="You are the designated auditor for this deployment: every account registers under your auditor id. Amounts that everyone else sees as ciphertext, you read in cleartext: each transfer and withdrawal carries ECDH ciphertexts addressed to your key. No wallet, no proofs, and no account cooperation required."
    >
      <div className="space-y-6">
        <section className="rounded border border-amber-900/70 bg-amber-950/20 p-4">
          <h3 className="mb-1 font-medium text-amber-300">Your auditor key (id {active.auditorId})</h3>
          <p className="mb-3 text-xs text-neutral-400">
            Demo-only: this secret ships with the app so anyone can take the auditor role.
            In a real deployment it lives in the auditor&apos;s vault and only the public key{" "}
            <code>K_aud = k·H</code> is registered on-chain.
          </p>
          <dl className="space-y-1 break-all font-mono text-xs text-neutral-300">
            <div>
              <dt className="inline text-neutral-500">secret k: </dt>
              <dd className="inline">{active.auditorSecretHex}</dd>{" "}
              <CopyButton label="Copy" payload={() => active.auditorSecretHex} />
            </div>
            <div>
              <dt className="inline text-neutral-500">K_aud.x: </dt>
              <dd className="inline">{toHex32(kAud.x)}</dd>
            </div>
            <div>
              <dt className="inline text-neutral-500">K_aud.y: </dt>
              <dd className="inline">{toHex32(kAud.y)}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded border border-neutral-800 p-4">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-medium">Accounts as you see them</h3>
            <button
              onClick={load}
              disabled={busy}
              className="rounded bg-neutral-800 px-3 py-1.5 text-sm font-medium hover:bg-neutral-700 disabled:opacity-50"
            >
              {busy ? "Decrypting…" : "Reload + decrypt"}
            </button>
          </div>
          <p className="mb-3 text-xs text-neutral-400">
            Reconstructed from sender-channel balance checkpoints and decrypted inbound credits
            (DESIGN.md §8.1).{" "}
            {hasIndexer
              ? "Backed by the Goldsky indexer, so the full deployment history is decrypted."
              : "Only events inside the RPC's ~7-day retention window are available — accounts with older history may be incomplete."}
          </p>
          {accounts.length === 0 && !busy && (
            <p className="text-sm text-neutral-500">No accounts in the retention window.</p>
          )}
          {accounts.length > 0 && (
            <table className="w-full text-left text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="pb-2 font-normal">account</th>
                  <th className="pb-2 font-normal">spendable</th>
                  <th className="pb-2 font-normal">receiving</th>
                  {anyEscrow && <th className="pb-2 font-normal">escrowed with spenders</th>}
                  <th className="pb-2 font-normal">last seen</th>
                </tr>
              </thead>
              <tbody className="text-neutral-300">
                {accounts.map((a) => (
                  <tr key={a.address} className="border-t border-neutral-900">
                    <td className="py-1.5">
                      <Addr value={a.address} />
                    </td>
                    <td className="py-1.5">{a.spendable === null ? "?" : `${stroopsToXlm(a.spendable)} XLM`}</td>
                    <td className="py-1.5">{stroopsToXlm(a.receiving)} XLM</td>
                    {anyEscrow && (
                      <td className="py-1.5">{stroopsToXlm(a.escrowed)} XLM</td>
                    )}
                    <td className="py-1.5 text-neutral-500">ledger {a.lastLedger}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded border border-neutral-800 p-4">
          <h3 className="mb-1 font-medium">Decrypted activity</h3>
          <p className="mb-3 text-xs text-neutral-400">
            Every token-contract event {hasIndexer ? "since deployment" : "in the retention window"},
            newest first. Amounts the wallet page shows as &ldquo;confidential&rdquo; appear here in
            cleartext — decrypted with your key alone.
          </p>
          {error && (
            <ErrorBox size="sm" className="mb-3">
              {error}
            </ErrorBox>
          )}
          {!rows && busy && <p className="text-sm text-neutral-500">Syncing events…</p>}
          {rows && rows.length === 0 && (
            <p className="text-sm text-neutral-500">No activity in the retention window.</p>
          )}
          {rows && (
            <ul className="space-y-2">
              {rows.map((row) => (
                <AuditRowView key={row.ev.cursor} row={row} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}

function AuditRowView({ row }: { row: AuditRow }) {
  const { ev } = row;
  const parties = partiesOf(ev);
  return (
    <li className="rounded border border-neutral-900 bg-neutral-500/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeCls(ev.type)}`}>{ev.type}</span>
        <span className="text-xs text-neutral-400">{parties}</span>
        <span className="flex-1" />
        {row.amount !== null && (
          <span className="text-sm font-medium text-amber-300">{stroopsToXlm(row.amount)} XLM</span>
        )}
        {!row.channelsAgree && (
          <span className="rounded bg-red-900 px-2 py-0.5 text-xs text-red-300">undecryptable</span>
        )}
      </div>
      <div className="mt-1.5 text-xs text-neutral-400">
        {row.text}
        {row.senderBalance !== null && (
          <> · sender&apos;s balance now <span className="text-neutral-300">{stroopsToXlm(row.senderBalance)} XLM</span></>
        )}
      </div>
      <div className="mt-1 text-xs text-neutral-600">
        ledger {ev.ledger} · tx <TxLink hash={ev.txHash} />
      </div>
    </li>
  );
}

function partiesOf(ev: ConfidentialEvent): React.ReactNode {
  switch (ev.type) {
    case "deposit":
    case "withdraw":
    case "transfer":
      return (
        <>
          <Addr value={ev.from} /> → <Addr value={ev.to} />
        </>
      );
    case "spender_transfer":
      return (
        <>
          <Addr value={ev.from} /> → <Addr value={ev.to} /> via <Addr value={ev.spender} />
        </>
      );
    case "set_spender":
    case "revoke_spender":
      return (
        <>
          <Addr value={ev.account} /> ⇄ spender <Addr value={ev.spender} />
        </>
      );
    case "compliance_config_changed":
      return null;
    default:
      return <Addr value={ev.account} />;
  }
}

function badgeCls(type: ConfidentialEvent["type"]): string {
  switch (type) {
    case "transfer":
    case "spender_transfer":
      return "bg-amber-900 text-amber-300";
    case "set_spender":
    case "revoke_spender":
      return "bg-indigo-900 text-indigo-300";
    case "clawback":
    case "frozen":
      return "bg-red-900 text-red-300";
    case "deposit":
      return "bg-sky-900 text-sky-300";
    case "withdraw":
      return "bg-orange-900 text-orange-300";
    case "register":
      return "bg-purple-900 text-purple-300";
    case "merge":
      return "bg-neutral-800 text-neutral-300";
    default:
      return "bg-neutral-800 text-neutral-300";
  }
}
