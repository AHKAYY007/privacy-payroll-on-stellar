/**
 * Client helpers for the demo-owned contracts the SDK doesn't know: the
 * superset factory's added functions (contracts/factory) and the blocklist
 * policy (contracts/blocklist-policy).
 *
 * They mirror the SDK's chain/factory.ts and chain/admin.ts conventions — a
 * `u32` salt passed last, the authorizing role holder as a trailing
 * `operator` — so the advanced wizard and the admin dashboard treat both
 * policy kinds alike. Arg tuples mirror the Rust signatures; keep them in sync
 * with contracts/factory/src/contract.rs and contracts/blocklist-policy.
 */

import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  randomSalt,
  type AllowlistAndTokenParams,
  type ChainClient,
  type FactoryWiring,
  type InvokeResult,
  type Signer,
} from "stellar-confidential-token-sdk";

const addr = (a: string): xdr.ScVal => new Address(a).toScVal();
const u32 = (n: number): xdr.ScVal => xdr.ScVal.scvU32(n);

function requireAddr(rv: xdr.ScVal | undefined, method: string): string {
  if (!rv) throw new Error(`${method} returned no value`);
  return Address.fromScVal(rv).toString();
}

const vanillaArgs = (w: FactoryWiring, salt: number) => [
  addr(w.underlying),
  addr(w.verifier),
  addr(w.auditor),
  u32(salt),
];

const blocklistArgs = (admin: string, manager: string, salt: number) => [
  addr(admin),
  addr(manager),
  u32(salt),
];

// ----- factory ---------------------------------------------------------------

/**
 * `deploy_vanilla_token(underlying_asset, verifier, auditor, salt)` → a
 * NoHooks token: no admin, so nobody can freeze or claw back on it.
 */
export async function deployVanillaToken(
  client: ChainClient,
  signer: Signer,
  w: FactoryWiring,
  salt: number = randomSalt(),
): Promise<string> {
  const r = await client.invoke(w.factory, "deploy_vanilla_token", vanillaArgs(w, salt), signer);
  return requireAddr(r.returnValue, "deploy_vanilla_token");
}

/** `deploy_blocklist(admin, manager, salt)` → blocklist policy address. */
export async function deployBlocklist(
  client: ChainClient,
  signer: Signer,
  factory: string,
  admin: string,
  manager: string,
  salt: number = randomSalt(),
): Promise<string> {
  const r = await client.invoke(factory, "deploy_blocklist", blocklistArgs(admin, manager, salt), signer);
  return requireAddr(r.returnValue, "deploy_blocklist");
}

/**
 * `deploy_blocklist_and_token(policy_admin, policy_manager, token_admin,
 * underlying_asset, verifier, auditor, sac_passthrough, salt)` →
 * `{ policy, token }`: the blocklist counterpart of the SDK's
 * `deployAllowlistAndToken`, with the same parameters.
 */
export async function deployBlocklistAndToken(
  client: ChainClient,
  signer: Signer,
  w: FactoryWiring,
  p: AllowlistAndTokenParams,
  salt: number = randomSalt(),
): Promise<{ policy: string; token: string }> {
  const r = await client.invoke(
    w.factory,
    "deploy_blocklist_and_token",
    [
      addr(p.policyAdmin),
      addr(p.policyManager),
      addr(p.tokenAdmin),
      addr(w.underlying),
      addr(w.verifier),
      addr(w.auditor),
      xdr.ScVal.scvBool(p.sacPassthrough),
      u32(salt),
    ],
    signer,
  );
  const vec = r.returnValue?.vec();
  if (!vec || vec.length !== 2) {
    throw new Error("deploy_blocklist_and_token: expected a (policy, token) tuple");
  }
  return {
    policy: Address.fromScVal(vec[0]!).toString(),
    token: Address.fromScVal(vec[1]!).toString(),
  };
}

/** `predict_vanilla_token_address(...)` — same arguments as {@link deployVanillaToken}. */
export async function predictVanillaTokenAddress(
  client: ChainClient,
  w: FactoryWiring,
  salt: number,
): Promise<string> {
  return requireAddr(
    await client.simulate(w.factory, "predict_vanilla_token_address", vanillaArgs(w, salt)),
    "predict_vanilla_token_address",
  );
}

/** `predict_blocklist_address(admin, manager, salt)`. */
export async function predictBlocklistAddress(
  client: ChainClient,
  factory: string,
  admin: string,
  manager: string,
  salt: number,
): Promise<string> {
  return requireAddr(
    await client.simulate(factory, "predict_blocklist_address", blocklistArgs(admin, manager, salt)),
    "predict_blocklist_address",
  );
}

// ----- blocklist policy (manager) ---------------------------------------------

/** `blocked(account)` on a blocklist policy. */
export async function isBlocked(client: ChainClient, policyId: string, account: string): Promise<boolean> {
  return scValToNative(await client.simulate(policyId, "blocked", [addr(account)])) === true;
}

/** `block(account, operator)` on a blocklist policy — `operator` holds `manager`. */
export function blockUser(
  client: ChainClient,
  signer: Signer,
  policyId: string,
  account: string,
  operator: string,
): Promise<InvokeResult> {
  return client.invoke(policyId, "block", [addr(account), addr(operator)], signer);
}

/** `unblock(account, operator)` on a blocklist policy — `operator` holds `manager`. */
export function unblockUser(
  client: ChainClient,
  signer: Signer,
  policyId: string,
  account: string,
  operator: string,
): Promise<InvokeResult> {
  return client.invoke(policyId, "unblock", [addr(account), addr(operator)], signer);
}
