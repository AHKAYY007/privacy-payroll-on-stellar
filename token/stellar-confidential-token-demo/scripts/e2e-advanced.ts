/**
 * Advanced-mode end-to-end on testnet: the superset factory and the admin
 * flows, driven through the same helpers the app uses (the SDK's factory/admin
 * modules and packages/app/lib/demo-contracts.ts).
 *
 *   for each kind (vanilla, compliant, allowlist, blocklist):
 *     predict → deploy through the factory → deployed address == predicted
 *   compliant token: no role at construction → grant freezer → freeze
 *     blocks deposit (3601; register is gated by the policy only) → unfreeze
 *   blocklist token: block gates register (3602) → unblock → register;
 *     grant config_manager, detach the policy via set_compliance_config →
 *     re-attach it
 *   allowlist token: register refused until allowed
 *
 * Every register carries a real proof, verified on-chain.
 *
 * Usage: pnpm e2e:advanced (after pnpm deploy:contracts)
 * Uses fresh friendbot-funded accounts each run.
 */

import { Keypair } from "@stellar/stellar-sdk";
import {
  ChainClient,
  CircuitProver,
  MANAGER_ROLE,
  TOKEN_ROLES,
  addressToField,
  buildRegisterWitness,
  deployAllowlistAndToken,
  deployToken,
  deriveKeys,
  freezeAccount,
  grantRole,
  hasRole,
  isAllowed,
  isFrozen,
  keypairSigner,
  allowUser,
  parseContractErrorCode,
  predictAllowlistAddress,
  predictTokenAddress,
  randomSalt,
  randomScalar,
  readAdmin,
  readComplianceConfig,
  setComplianceConfig,
  submitDeposit,
  submitRegister,
  unfreezeAccount,
  type FactoryWiring,
  type Signer,
} from "stellar-confidential-token-sdk";
import { loadCircuit } from "stellar-confidential-token-sdk/proving/artifacts";

import {
  blockUser,
  deployBlocklistAndToken,
  deployVanillaToken,
  isBlocked,
  predictBlocklistAddress,
  predictVanillaTokenAddress,
  unblockUser,
} from "../packages/app/lib/demo-contracts.js";
import { RPC_URL, PASSPHRASE, loadDeployment, friendbotFund } from "./_shared.js";

const AUDITOR_ID = 0;

async function freshAccount(label: string): Promise<{ address: string; signer: Signer }> {
  const kp = Keypair.random();
  await friendbotFund(kp.publicKey());
  console.log(`  ${label} = ${kp.publicKey()}`);
  return { address: kp.publicKey(), signer: keypairSigner(kp.secret(), PASSPHRASE) };
}

async function main(): Promise<void> {
  const dep = loadDeployment();
  console.log(`factory = ${dep.contracts.factory}`);
  const client = new ChainClient({
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
    contracts: { token: dep.contracts.token, verifier: dep.contracts.verifier, auditor: dep.contracts.auditor },
  });
  const wiring: FactoryWiring = {
    factory: dep.contracts.factory,
    underlying: dep.contracts.underlying,
    verifier: dep.contracts.verifier,
    auditor: dep.contracts.auditor,
  };
  const registerProver = new CircuitProver(loadCircuit("register"));

  /** Run a submission; the contract error code it failed with, or null. */
  async function codeOf(submit: () => Promise<unknown>): Promise<number | null> {
    try {
      await submit();
      return null;
    } catch (e) {
      const code = parseContractErrorCode(String((e as Error)?.message ?? e));
      if (code === null) throw e;
      return code;
    }
  }

  /** Prove and submit `register` for `who` on `token`. */
  async function register(token: string, who: { address: string; signer: Signer }): Promise<number | null> {
    const keys = deriveKeys(randomScalar(), addressToField(token));
    const w = buildRegisterWitness(keys, who.address);
    const { proof } = await registerProver.prove(w.inputs);
    client.cfg.contracts.token = token;
    return codeOf(() => submitRegister(client, who.signer, who.address, AUDITOR_ID, w, proof));
  }

  /** Deposit 1 XLM into `who`'s own receiving balance on `token`. */
  function deposit(token: string, who: { address: string; signer: Signer }): Promise<number | null> {
    client.cfg.contracts.token = token;
    return codeOf(() => submitDeposit(client, who.signer, who.address, who.address, 10_000_000n));
  }

  try {
    console.log("\n[accounts]");
    const admin = await freshAccount("admin");
    const alice = await freshAccount("alice");
    const me = admin.address;
    const roles = { policyAdmin: me, policyManager: me, tokenAdmin: me, sacPassthrough: false };
    const noPolicy = { policy: null, sacPassthrough: false };

    console.log("\n[vanilla]");
    {
      const salt = randomSalt();
      const predicted = await predictVanillaTokenAddress(client, wiring, salt);
      const token = await deployVanillaToken(client, admin.signer, wiring, salt);
      assert(token === predicted, `vanilla deployed ${token}, predicted ${predicted}`);
      console.log(`  deployed at the predicted address ${token} ✓`);
      assert((await register(token, alice)) === null, "alice could not register on the vanilla token");
      console.log("  alice registered with no permission needed ✓");
    }

    console.log("\n[compliant, no policy]");
    {
      const salt = randomSalt();
      const predicted = await predictTokenAddress(client, wiring, me, noPolicy, salt);
      const token = await deployToken(client, admin.signer, wiring, me, noPolicy, salt);
      assert(token === predicted, `compliant deployed ${token}, predicted ${predicted}`);
      assert((await readAdmin(client, token)) === me, "token admin is not the deployer");
      assert(!(await hasRole(client, token, me, TOKEN_ROLES.freezer)), "freezer granted at construction");
      console.log(`  deployed at the predicted address, admin = deployer, no role granted ✓`);

      assert((await register(token, alice)) === null, "alice could not register");
      const unauthorized = await codeOf(() => freezeAccount(client, admin.signer, token, alice.address, me));
      assert(unauthorized === 2000, `freeze without the role returned ${unauthorized}, want 2000`);
      console.log("  alice registered; freezing without the freezer role is refused (2000) ✓");

      await grantRole(client, admin.signer, token, me, TOKEN_ROLES.freezer, me);
      assert(await hasRole(client, token, me, TOKEN_ROLES.freezer), "freezer grant didn't stick");
      await freezeAccount(client, admin.signer, token, alice.address, me);
      assert(await isFrozen(client, token, alice.address), "alice not frozen");
      const frozenCode = await deposit(token, alice);
      assert(frozenCode === 3601, `frozen deposit returned ${frozenCode}, want 3601`);
      console.log("  freezer granted; a frozen account can't deposit (3601) ✓");

      await unfreezeAccount(client, admin.signer, token, alice.address, me);
      assert((await deposit(token, alice)) === null, "alice could not deposit after unfreeze");
      console.log("  unfrozen; alice deposited ✓");
    }

    console.log("\n[compliant + allowlist]");
    {
      const salt = randomSalt();
      const policy = await predictAllowlistAddress(client, wiring.factory, me, me, salt);
      const predicted = await predictTokenAddress(client, wiring, me, { policy, sacPassthrough: false }, salt);
      const res = await deployAllowlistAndToken(client, admin.signer, wiring, roles, salt);
      assert(res.policy === policy && res.token === predicted, "allowlist + token not at the predicted addresses");
      assert(await hasRole(client, policy, me, MANAGER_ROLE), "allowlist manager not granted");
      console.log(`  deployed at the predicted addresses, manager granted ✓`);

      const code = await register(res.token, alice);
      assert(code === 3602, `unlisted register returned ${code}, want 3602`);
      await allowUser(client, admin.signer, policy, alice.address, me);
      assert(await isAllowed(client, policy, alice.address), "alice not allowed");
      assert((await register(res.token, alice)) === null, "alice could not register once allowed");
      console.log("  register refused until allowed (3602), then accepted ✓");
    }

    console.log("\n[compliant + blocklist]");
    {
      const salt = randomSalt();
      const policy = await predictBlocklistAddress(client, wiring.factory, me, me, salt);
      const allowlistTwin = await predictAllowlistAddress(client, wiring.factory, me, me, salt);
      assert(policy !== allowlistTwin, "blocklist and allowlist collide for the same (admin, manager, salt)");
      const predicted = await predictTokenAddress(client, wiring, me, { policy, sacPassthrough: false }, salt);
      const res = await deployBlocklistAndToken(client, admin.signer, wiring, roles, salt);
      assert(res.policy === policy && res.token === predicted, "blocklist + token not at the predicted addresses");
      assert(await hasRole(client, policy, me, MANAGER_ROLE), "blocklist manager not granted");
      console.log(`  deployed at the predicted addresses (distinct from the allowlist's), manager granted ✓`);

      await blockUser(client, admin.signer, policy, alice.address, me);
      assert(await isBlocked(client, policy, alice.address), "alice not blocked");
      const code = await register(res.token, alice);
      assert(code === 3602, `blocked register returned ${code}, want 3602`);
      console.log("  a blocked account can't register (3602) ✓");

      // Detach the policy, and the block no longer applies.
      await grantRole(client, admin.signer, res.token, me, TOKEN_ROLES.configManager, me);
      await setComplianceConfig(client, admin.signer, res.token, noPolicy, me);
      assert((await readComplianceConfig(client, res.token))?.policy === null, "policy not detached");
      await setComplianceConfig(client, admin.signer, res.token, { policy, sacPassthrough: false }, me);
      assert((await readComplianceConfig(client, res.token))?.policy === policy, "policy not re-attached");
      console.log("  config_manager detached and re-attached the policy ✓");

      await unblockUser(client, admin.signer, policy, alice.address, me);
      assert(!(await isBlocked(client, policy, alice.address)), "alice still blocked");
      assert((await register(res.token, alice)) === null, "alice could not register once unblocked");
      console.log("  unblocked; alice registered ✓");
    }

    console.log("\n✅ advanced e2e complete — every factory kind and admin flow verified on testnet.");
  } finally {
    await registerProver.destroy();
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

main().catch((e) => {
  console.error("\n❌", e);
  process.exit(1);
});
