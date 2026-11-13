"use client";

/**
 * Token-admin dashboard. The admin of a compliant confidential token manages
 * compliance here:
 *
 *  1. Roles — the token's constructor grants none of `freezer`,
 *     `config_manager` and `clawback`, so the admin grants them (to itself, in
 *     this demo) before any compliance call can succeed. The policy's
 *     `manager` role is granted to the deployer at construction.
 *  2. Registered accounts — every `register` event on the token.
 *  3. Freeze panel (all compliant configs, `freezer`) — freeze/unfreeze
 *     accounts; the frozen set is replayed from `frozen`/`unfrozen` events.
 *  4. Policy panel (allowlist/blocklist, the policy's `manager`) —
 *     allow/disallow or block/unblock; the membership set is replayed from
 *     `user_*` events on the policy contract.
 *  5. Compliance config (`config_manager`) — detach or re-attach the policy.
 *  6. Redeploy — the only way to reconfigure/redeploy an advanced deployment,
 *     so it's also shown (without the panels above) for a vanilla token
 *     deployed in advanced mode, which has no admin or compliance to manage.
 *
 * Access requires a Freighter connection whose account is the token's
 * access-control admin. Every mutation is role-gated on-chain and names the
 * connected account as its `operator`. A vanilla deployment has no admin, so
 * it skips this gate entirely.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  hybridFetchEvents,
  readAdmin,
  hasRole,
  grantRole,
  revokeRole,
  readComplianceConfig,
  setComplianceConfig,
  freezeAccount,
  unfreezeAccount,
  allowUser,
  disallowUser,
  MANAGER_ROLE,
  TOKEN_ROLES,
  type ChainClient,
  type ComplianceConfig,
  type ConfidentialEvent,
  type ComplianceEventType,
} from "stellar-confidential-token-sdk";
import { blockUser, unblockUser } from "@/lib/demo-contracts";
import { useActiveDeployment } from "@/lib/active-deployment";
import { hasAdminDashboard } from "@/lib/deployment";
import { connectFreighter, type MessageSigner } from "@/lib/freighter";
import { clientsFor } from "@/lib/rpc";
import { errMsg } from "@/lib/err";
import { PageShell } from "../page-shell";
import { ErrorBox } from "../error-box";
import { Addr } from "../addr";

/** Small triangular alert glyph — marks the danger-zone header. */
function Warning() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
      <path
        d="M8 2 14.5 13.5h-13z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8 6.3v3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="11.3" r="0.75" fill="currentColor" />
    </svg>
  );
}

interface Registered {
  account: string;
  auditorId: number;
}

/** A role the connected admin can hold, on the token or on its policy. */
interface RoleSpec {
  key: string;
  role: string;
  on: "token" | "policy";
  grants: string;
}

const TOKEN_ROLE_SPECS: RoleSpec[] = [
  { key: "freezer", role: TOKEN_ROLES.freezer, on: "token", grants: "freeze and unfreeze accounts" },
  {
    key: "config_manager",
    role: TOKEN_ROLES.configManager,
    on: "token",
    grants: "change the compliance configuration",
  },
  {
    key: "clawback",
    role: TOKEN_ROLES.clawback,
    on: "token",
    grants: "seize a frozen account's balance with its auditor's proof (not exercised by this demo)",
  },
];
const POLICY_ROLE_SPEC: RoleSpec = {
  key: "manager",
  role: MANAGER_ROLE,
  on: "policy",
  grants: "edit the policy's membership (granted to the deployer at construction)",
};

type Roles = Record<string, boolean>;

async function readRoles(
  client: ChainClient,
  specs: RoleSpec[],
  ids: { token: string; policy?: string },
  account: string,
): Promise<Roles> {
  const held = await Promise.all(
    specs.map((r) => hasRole(client, r.on === "token" ? ids.token : ids.policy!, account, r.role)),
  );
  return Object.fromEntries(specs.map((r, i) => [r.key, held[i]!]));
}

function registeredAccounts(events: ConfidentialEvent[]): Registered[] {
  const seen = new Map<string, number>();
  for (const ev of events) if (ev.type === "register") seen.set(ev.account, ev.auditorId);
  return [...seen.entries()].map(([account, auditorId]) => ({ account, auditorId }));
}

/** Current membership set: add events add, remove events remove. */
function replaySet(
  events: ConfidentialEvent[],
  addType: ComplianceEventType,
  removeType: ComplianceEventType,
): string[] {
  const s = new Set<string>();
  for (const ev of events) {
    if (ev.type === addType) s.add((ev as { account: string }).account);
    else if (ev.type === removeType) s.delete((ev as { account: string }).account);
  }
  return [...s];
}

/** Redeploy — start over with a brand-new token. Styled as a danger zone
    (irreversible: the current token, its registrations, and compliance
    history are abandoned) and kept apart from the compliance panels because
    it replaces the whole deployment, not a setting within it. Shown for any
    deployment created in advanced mode (compliant or vanilla), since this
    dashboard is the only place to reach it. Forgets the current deployment
    on click — the /advanced wizard has nothing left to carry over. */
function RedeploySection() {
  const { clearAdvanced } = useActiveDeployment();
  return (
    <section className="mt-8 rounded border border-red-900/60 bg-red-950/10 p-4">
      <h2 className="mb-1 flex items-center gap-1.5 font-medium text-red-300">
        <Warning />
        Danger zone
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-neutral-400">
        Deploy a brand-new confidential token through the factory. This does not
        modify the current token — it replaces it as your active advanced deployment, so you start
        from scratch: no registered accounts, balances, or compliance history carry over, and the
        account you deploy with becomes the new admin.
      </p>
      <Link
        href="/advanced"
        onClick={clearAdvanced}
        className="items-center gap-1.5 rounded border bg-red-600 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-red-500"
      >
        Redeploy
      </Link>
    </section>
  );
}

export default function AdminPage() {
  const { active } = useActiveDeployment();
  const isVanilla = active.kind === "vanilla";
  // Any token deployed through the advanced wizard, vanilla included — the
  // built-in default is the only deployment excluded from this dashboard.
  const isCustomDeployment = hasAdminDashboard(active);
  const hasPolicy = active.kind === "allowlist" || active.kind === "blocklist";
  const roleSpecs = useMemo(
    () => (hasPolicy ? [...TOKEN_ROLE_SPECS, POLICY_ROLE_SPEC] : TOKEN_ROLE_SPECS),
    [hasPolicy],
  );

  const [signer, setSigner] = useState<MessageSigner | null>(null);
  const [admin, setAdmin] = useState<string | null>(null);
  const [adminLoaded, setAdminLoaded] = useState(false);
  const [roles, setRoles] = useState<Roles | null>(null);
  const [config, setConfig] = useState<ComplianceConfig | null>(null);
  const [registered, setRegistered] = useState<Registered[]>([]);
  const [frozen, setFrozen] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [freezeInput, setFreezeInput] = useState("");
  const [policyInput, setPolicyInput] = useState("");

  const account = signer?.publicKey ?? null;
  const isAdmin = !!account && !!admin && account === admin;

  const { client, indexer } = useMemo(() => clientsFor(active), [active]);

  // The admin is a public read; load it (and reset connection) whenever the
  // active token changes.
  useEffect(() => {
    setSigner(null);
    setAdmin(null);
    setAdminLoaded(false);
    setRoles(null);
    setConfig(null);
    setRegistered([]);
    setFrozen([]);
    setMembers([]);
    if (isVanilla) {
      setAdminLoaded(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const a = await readAdmin(client, active.contracts.token);
        if (!cancelled) setAdmin(a);
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      } finally {
        if (!cancelled) setAdminLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, active.contracts.token, isVanilla]);

  const loadLists = useCallback(async () => {
    if (!account) return;
    setBusy("loading");
    setError(null);
    try {
      const ids = { token: active.contracts.token, policy: active.contracts.policy };
      const [r, c] = await Promise.all([
        readRoles(client, roleSpecs, ids, account),
        readComplianceConfig(client, active.contracts.token),
      ]);
      setRoles(r);
      setConfig(c);

      const tokenEvents = (
        await hybridFetchEvents(client, indexer, {
          fromLedger: active.deployedAtLedger,
          contractId: active.contracts.token,
        })
      ).events;
      setRegistered(registeredAccounts(tokenEvents));
      setFrozen(replaySet(tokenEvents, "frozen", "unfrozen"));

      if (hasPolicy && active.contracts.policy) {
        const policyEvents = (
          await hybridFetchEvents(client, indexer, {
            fromLedger: active.deployedAtLedger,
            contractId: active.contracts.policy,
          })
        ).events;
        const [add, remove]: [ComplianceEventType, ComplianceEventType] =
          active.kind === "allowlist"
            ? ["user_allowed", "user_disallowed"]
            : ["user_blocked", "user_unblocked"];
        setMembers(replaySet(policyEvents, add, remove));
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }, [client, indexer, active, hasPolicy, account, roleSpecs]);

  // Once an admin is connected, load the lists.
  useEffect(() => {
    if (isAdmin) void loadLists();
  }, [isAdmin, loadLists]);

  const connect = useCallback(async () => {
    setError(null);
    setBusy("connecting");
    try {
      setSigner(await connectFreighter());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const runAction = useCallback(
    (label: string, fn: (s: MessageSigner) => Promise<unknown>) => async () => {
      if (!signer) return;
      setBusy(label);
      setError(null);
      try {
        await fn(signer);
        await loadLists();
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setBusy(null);
      }
    },
    [signer, loadLists],
  );

  const roleContract = (r: RoleSpec) => (r.on === "token" ? active.contracts.token : active.contracts.policy!);
  const missingTokenRoles = TOKEN_ROLE_SPECS.filter((r) => roles && !roles[r.key]);

  // ---- gating views -------------------------------------------------------

  if (isVanilla && !isCustomDeployment) {
    // The built-in default: no admin, no compliance, nothing to redeploy.
    return (
      <PageShell
        title="Token admin"
        subtitle="Manage compliance for the active confidential token: registered accounts, freezes, and (for allowlist/blocklist configs) policy membership."
      >
        <Notice>
          This deployment is a <b>vanilla</b> token — it has no admin, freeze, or policy, so there
          is no admin dashboard. Deploy a token of your own (compliant or not) in{" "}
          <a className="underline" href="/advanced">
            advanced mode
          </a>{" "}
          to unlock this page.
        </Notice>
      </PageShell>
    );
  }

  if (isVanilla) {
    // A custom vanilla deployment has no admin or compliance to manage, but
    // this dashboard is still the only way to redeploy it with a different
    // configuration — skip the Freighter/admin gate entirely, since there's
    // no admin for a vanilla token.
    return (
      <PageShell
        title="Token admin"
        subtitle="Manage compliance for the active confidential token: registered accounts, freezes, and (for allowlist/blocklist configs) policy membership."
      >
        <Notice>
          This deployment is a <b>vanilla</b> token — it has no admin, freeze, or policy, so there
          is nothing to manage here. You can still redeploy with a different configuration below.
        </Notice>
        <RedeploySection />
      </PageShell>
    );
  }

  if (!account) {
    return (
      <PageShell
        title="Token admin"
        subtitle="Manage compliance for the active confidential token: registered accounts, freezes, and (for allowlist/blocklist configs) policy membership."
      >
        <p className="mb-4 text-sm text-neutral-400">
          The admin dashboard requires the token admin&apos;s Freighter account.
        </p>
        <button
          onClick={connect}
          disabled={busy !== null}
          className="rounded bg-rose-600 px-4 py-2 text-sm font-medium hover:bg-rose-500 disabled:opacity-50"
        >
          {busy === "connecting" ? "Connecting…" : "Connect Freighter"}
        </button>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </PageShell>
    );
  }

  if (adminLoaded && !isAdmin) {
    return (
      <PageShell
        title="Token admin"
        subtitle="Manage compliance for the active confidential token: registered accounts, freezes, and (for allowlist/blocklist configs) policy membership."
      >
        <Notice tone="warn">
          You are connected as <Addr value={account} />, but this token&apos;s admin is{" "}
          {admin ? <Addr value={admin} /> : <span className="font-mono">unknown (renounced)</span>}. Switch to
          the admin account in Freighter, then reconnect below.
        </Notice>
        <button
          onClick={connect}
          disabled={busy !== null}
          className="mt-3 rounded bg-rose-600 px-4 py-2 text-sm font-medium hover:bg-rose-500 disabled:opacity-50"
        >
          {busy === "connecting" ? "Connecting…" : "Connect Freighter"}
        </button>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </PageShell>
    );
  }

  if (!adminLoaded) {
    return (
      <PageShell
        title="Token admin"
        subtitle="Manage compliance for the active confidential token: registered accounts, freezes, and (for allowlist/blocklist configs) policy membership."
      >
        <p className="text-sm text-neutral-500">Reading token admin…</p>
      </PageShell>
    );
  }

  // ---- admin dashboard ----------------------------------------------------

  return (
    <PageShell
      title="Token admin"
      subtitle="Manage compliance for the active confidential token: registered accounts, freezes, and (for allowlist/blocklist configs) policy membership."
    >
      {error && <ErrorBox className="mb-4">{error}</ErrorBox>}
      <div className="mb-4 flex items-center justify-between">
        <p className="flex items-center gap-1 text-sm text-neutral-400">
          Admin <span className="text-neutral-300"><Addr value={account} /></span>
        </p>
        <button
          onClick={loadLists}
          disabled={busy !== null}
          className="rounded bg-neutral-800 px-3 py-1.5 text-sm font-medium hover:bg-neutral-700 disabled:opacity-50"
        >
          {busy === "loading" ? "Loading…" : "Reload"}
        </button>
      </div>

      <div className="space-y-6">
        {/* Roles */}
        <section className="rounded border border-neutral-800 p-4">
          <h2 className="mb-1 font-medium">Roles</h2>
          <p className="mb-3 text-xs text-neutral-400">
            Compliance is split across roles, so each duty can sit with a different account. The
            token grants none of its roles at deployment: as its admin, grant the ones you need to
            yourself. Each grant is a Freighter signature.
          </p>
          {roles === null ? (
            <p className="text-sm text-neutral-500">Reading roles…</p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {roleSpecs.map((r) => (
                  <li
                    key={r.key}
                    className="flex items-center justify-between gap-3 rounded border border-neutral-900 bg-neutral-500/5 px-3 py-1.5 text-xs"
                  >
                    <span>
                      <code className="font-mono text-neutral-200">{r.role}</code>{" "}
                      <span className="text-neutral-500">
                        on the {r.on} · {r.grants}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {roles[r.key] ? (
                        <span className="text-emerald-300">held</span>
                      ) : (
                        <span className="text-neutral-500">not held</span>
                      )}
                      <button
                        onClick={runAction(`role:${r.key}`, (s) =>
                          (roles[r.key] ? revokeRole : grantRole)(
                            client,
                            s,
                            roleContract(r),
                            s.publicKey,
                            r.role,
                            s.publicKey,
                          ),
                        )}
                        disabled={busy !== null}
                        className="rounded border border-neutral-700 px-2.5 py-1 font-medium hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {roles[r.key] ? "Revoke" : "Grant to me"}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              {missingTokenRoles.length > 1 && (
                <button
                  onClick={runAction("role:all", async (s) => {
                    for (const r of missingTokenRoles) {
                      await grantRole(client, s, roleContract(r), s.publicKey, r.role, s.publicKey);
                    }
                  })}
                  disabled={busy !== null}
                  className="mt-3 rounded bg-rose-600 px-3 py-1.5 text-xs font-medium hover:bg-rose-500 disabled:opacity-50"
                >
                  {busy === "role:all"
                    ? "Granting…"
                    : `Grant all ${missingTokenRoles.length} token roles to me`}
                </button>
              )}
            </>
          )}
        </section>

        {/* Registered accounts */}
        <section className="rounded border border-neutral-800 p-4">
          <h2 className="mb-1 font-medium">Registered accounts</h2>
          <p className="mb-3 text-xs text-neutral-400">
            Every account that has registered a confidential balance on this token ({registered.length}).
          </p>
          {registered.length === 0 ? (
            <p className="text-sm text-neutral-500">No registered accounts yet.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="pb-2 font-normal">account</th>
                  <th className="pb-2 font-normal">auditor id</th>
                  <th className="pb-2 font-normal">status</th>
                </tr>
              </thead>
              <tbody className="text-neutral-300">
                {registered.map((r) => (
                  <tr key={r.account} className="border-t border-neutral-900">
                    <td className="py-1.5">
                      <Addr value={r.account} />
                    </td>
                    <td className="py-1.5">{r.auditorId}</td>
                    <td className="py-1.5">
                      {frozen.includes(r.account) ? (
                        <span className="text-red-300">frozen</span>
                      ) : hasPolicy ? (
                        members.includes(r.account) ? (
                          <span className="text-emerald-300">
                            {active.kind === "allowlist" ? "allowed" : "blocked"}
                          </span>
                        ) : (
                          <span className="text-neutral-500">
                            {active.kind === "allowlist" ? "not allowed" : "not blocked"}
                          </span>
                        )
                      ) : (
                        <span className="text-neutral-500">active</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Freeze panel (all compliant configs) */}
        <ManagePanel
          title="Freeze accounts"
          hint="A frozen account is blocked from every confidential operation until unfrozen."
          inputValue={freezeInput}
          setInput={setFreezeInput}
          placeholder="G… account to freeze"
          actionLabel="Freeze"
          actionTone="bg-red-600 hover:bg-red-500"
          onAction={runAction("freeze", (s) =>
            freezeAccount(client, s, active.contracts.token, freezeInput.trim(), s.publicKey),
          )}
          busy={busy}
          disabledReason={roles && !roles.freezer ? "Grant yourself the freezer role above first." : undefined}
          list={frozen}
          listTitle="Frozen accounts"
          rowActionLabel="Unfreeze"
          onRowAction={(acct) =>
            runAction(`unfreeze:${acct}`, (s) =>
              unfreezeAccount(client, s, active.contracts.token, acct, s.publicKey),
            )()
          }
        />

        {/* Policy panel (allowlist / blocklist) */}
        {hasPolicy && (
          <ManagePanel
            title={active.kind === "allowlist" ? "Allowlist (KYC)" : "Blocklist (KYC)"}
            hint={
              active.kind === "allowlist"
                ? "Only allowed accounts may transact, and registering counts: allow a holder before they register. Allow an address after KYC; disallow to revoke."
                : "Every account may transact except those blocked. Block an address to deny it (e.g. sanctions)."
            }
            inputValue={policyInput}
            setInput={setPolicyInput}
            placeholder={active.kind === "allowlist" ? "G… account to allow" : "G… account to block"}
            actionLabel={active.kind === "allowlist" ? "Allow" : "Block"}
            actionTone="bg-emerald-600 hover:bg-emerald-500"
            onAction={runAction(active.kind === "allowlist" ? "allow" : "block", (s) =>
              active.kind === "allowlist"
                ? allowUser(client, s, active.contracts.policy!, policyInput.trim(), s.publicKey)
                : blockUser(client, s, active.contracts.policy!, policyInput.trim(), s.publicKey),
            )}
            busy={busy}
            disabledReason={
              roles && !roles.manager ? "Only the policy's manager can edit its membership." : undefined
            }
            list={members}
            listTitle={active.kind === "allowlist" ? "Allowed accounts" : "Blocked accounts"}
            rowActionLabel={active.kind === "allowlist" ? "Disallow" : "Unblock"}
            onRowAction={(acct) =>
              runAction(`${active.kind === "allowlist" ? "disallow" : "unblock"}:${acct}`, (s) =>
                active.kind === "allowlist"
                  ? disallowUser(client, s, active.contracts.policy!, acct, s.publicKey)
                  : unblockUser(client, s, active.contracts.policy!, acct, s.publicKey),
              )()
            }
          />
        )}

        {/* Compliance config */}
        <ConfigPanel
          config={config}
          policy={active.contracts.policy}
          canEdit={!!roles?.config_manager}
          busy={busy}
          onSet={(next) =>
            runAction("config", (s) =>
              setComplianceConfig(client, s, active.contracts.token, next, s.publicKey),
            )()
          }
        />
      </div>

      {isCustomDeployment && <RedeploySection />}
    </PageShell>
  );
}

function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  const cls =
    tone === "warn"
      ? "border-amber-800 bg-amber-950/30 text-amber-200"
      : "border-neutral-800 bg-neutral-900/40 text-neutral-300";
  return <div className={`rounded border p-4 text-sm leading-relaxed ${cls}`}>{children}</div>;
}

interface ManagePanelProps {
  title: string;
  hint: string;
  inputValue: string;
  setInput: (v: string) => void;
  placeholder: string;
  actionLabel: string;
  actionTone: string;
  onAction: () => void;
  busy: string | null;
  /** Why the actions are unavailable to the connected account, if they are. */
  disabledReason?: string;
  list: string[];
  listTitle: string;
  rowActionLabel: string;
  onRowAction: (account: string) => void;
}

function ManagePanel(p: ManagePanelProps) {
  return (
    <section className="rounded border border-neutral-800 p-4">
      <h2 className="mb-1 font-medium">{p.title}</h2>
      <p className="mb-3 text-xs text-neutral-400">{p.hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={p.inputValue}
          onChange={(e) => p.setInput(e.target.value)}
          placeholder={p.placeholder}
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-xs outline-none focus:border-rose-500"
        />
        <button
          onClick={p.onAction}
          disabled={p.busy !== null || p.inputValue.trim().length === 0 || !!p.disabledReason}
          title={p.disabledReason}
          className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${p.actionTone}`}
        >
          {p.actionLabel}
        </button>
      </div>
      {p.disabledReason && <p className="mt-2 text-xs text-amber-300">{p.disabledReason}</p>}
      <div className="mt-4">
        <h3 className="mb-2 text-xs font-medium text-neutral-400">
          {p.listTitle} ({p.list.length})
        </h3>
        {p.list.length === 0 ? (
          <p className="text-sm text-neutral-500">None.</p>
        ) : (
          <ul className="space-y-1.5">
            {p.list.map((acct) => (
              <li
                key={acct}
                className="flex items-center justify-between rounded border border-neutral-900 bg-neutral-500/5 px-3 py-1.5"
              >
                <span className="text-xs text-neutral-300">
                  <Addr value={acct} />
                </span>
                <button
                  onClick={() => p.onRowAction(acct)}
                  disabled={p.busy !== null || !!p.disabledReason}
                  title={p.disabledReason}
                  className="rounded border border-neutral-700 px-2.5 py-1 text-xs font-medium hover:bg-neutral-800 disabled:opacity-50"
                >
                  {p.rowActionLabel}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * The token's live compliance configuration. The demo only toggles the policy
 * between none and the one deployed with the token; `sac_passthrough` stays
 * off for every demo token (native XLM can't be deauthorized anyway).
 */
function ConfigPanel(p: {
  config: ComplianceConfig | null;
  policy?: string;
  canEdit: boolean;
  busy: string | null;
  onSet: (next: ComplianceConfig) => void;
}) {
  const { config, policy, canEdit, busy, onSet } = p;
  return (
    <section className="rounded border border-neutral-800 p-4">
      <h2 className="mb-1 font-medium">Compliance configuration</h2>
      <p className="mb-3 text-xs text-neutral-400">
        Which external policy every operation consults, and whether it also asks the underlying
        asset&apos;s SAC for authorization. Changing it emits <code>compliance_config_changed</code>.
      </p>
      {config === null ? (
        <p className="text-sm text-neutral-500">Reading configuration…</p>
      ) : (
        <div className="space-y-2 text-xs">
          <p className="text-neutral-300">
            policy:{" "}
            {config.policy ? <Addr value={config.policy} /> : <span className="text-neutral-500">none</span>}
            <span className="mx-2 text-neutral-600">·</span>
            sac_passthrough: <span className="font-mono">{String(config.sacPassthrough)}</span>
          </p>
          {policy && (
            <button
              onClick={() =>
                onSet({ ...config, policy: config.policy ? null : policy })
              }
              disabled={busy !== null || !canEdit}
              title={canEdit ? undefined : "Grant yourself the config_manager role above first."}
              className="rounded border border-neutral-700 px-2.5 py-1 font-medium hover:bg-neutral-800 disabled:opacity-50"
            >
              {config.policy ? "Detach the policy" : "Re-attach the policy"}
            </button>
          )}
          {!canEdit && (
            <p className="text-amber-300">Grant yourself the config_manager role above to change it.</p>
          )}
        </div>
      )}
    </section>
  );
}
