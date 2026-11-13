/**
 * Deploy the confidential-token demo (stellar-confidential 0.8.0) to Stellar
 * testnet:
 *
 *   1. Ensure the native XLM Stellar Asset Contract exists (the underlying
 *      SEP-41 — chosen because it needs no minting or trustlines).
 *   2. Deploy the verifier and auditor registries (admin = manager = deployer)
 *      and register the six circuit verification keys.
 *   3. Register one auditor key (id 0), K_aud = k·H for a random k.
 *   4. Deploy the default token: a vanilla (NoHooks) token, so nobody can
 *      freeze an account or claw back a balance on it.
 *   5. Assert the contract's stored address-as-field equals the SDK's
 *      `addressToField(token)` — the Poseidon2 parity guard.
 *   6. Upload the four wasms the factory deploys and deploy the factory.
 *   7. Write deployments/testnet.json.
 *
 * Usage: pnpm deploy:contracts (after pnpm build:contracts)
 * Deployer identity: the `admin` key in the stellar CLI config.
 */

import { xdr, Address } from "@stellar/stellar-sdk";
import {
  CIRCUIT_TYPE,
  ChainClient,
  H,
  addressToField,
  fromBytesBE,
  keypairSigner,
  pointCoords,
  pointToBytes,
  randomScalar,
  scalarMul,
  toHex32,
} from "stellar-confidential-token-sdk";

import {
  NETWORK, RPC_URL, PASSPHRASE, PROTOCOL, WASM,
  stellar, stellarSoft, publicKey, secret, readVk, saveDeployment, type Deployment,
} from "./_shared.js";

const DEPLOYER = "admin";

// vk.bin filename → CircuitType discriminant: every circuit the verifier
// accepts, including the ones the demo never proves (anyone may call
// set_spender, and a compliant token's clawback proves under `clawback`).
const VK_FILES: ReadonlyArray<[string, number]> = [
  ["register", CIRCUIT_TYPE.Register],
  ["withdraw", CIRCUIT_TYPE.Withdraw],
  ["transfer", CIRCUIT_TYPE.Transfer],
  ["spender_transfer", CIRCUIT_TYPE.SpenderTransfer],
  ["set_spender", CIRCUIT_TYPE.SetSpender],
  ["clawback", CIRCUIT_TYPE.Clawback],
];

/** Deploy from an uploaded wasm hash or a local wasm file. */
function deploy(from: { wasm: string } | { hash: string }, ctorArgs: string[]): string {
  const out = stellar([
    "contract", "deploy",
    // build-contracts.sh already optimized the wasm; don't let the CLI redo it.
    ...("wasm" in from ? ["--wasm", from.wasm, "--optimize=false"] : ["--wasm-hash", from.hash]),
    "--source", DEPLOYER,
    "--network", NETWORK,
    "--", ...ctorArgs,
  ]);
  // The contract id is the last non-empty line of stdout.
  const id = out.split(/\s+/).filter(Boolean).pop()!;
  if (!id.startsWith("C")) throw new Error(`unexpected deploy output: ${out}`);
  return id;
}

/** Install a contract WASM on-chain, returning its 32-byte hash (hex). */
function upload(wasmPath: string): string {
  const out = stellar([
    "contract", "upload",
    "--wasm", wasmPath,
    "--source", DEPLOYER,
    "--network", NETWORK,
  ]);
  // The wasm hash is the last non-empty token of stdout (64 hex chars).
  const hash = out.split(/\s+/).filter(Boolean).pop()!;
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`unexpected upload output: ${out}`);
  return hash.toLowerCase();
}

async function main(): Promise<void> {
  const deployerPub = publicKey(DEPLOYER);
  console.log(`deployer ${DEPLOYER} = ${deployerPub}`);
  const signer = keypairSigner(secret(DEPLOYER), PASSPHRASE);

  // 1. Native XLM SAC as the underlying asset.
  stellarSoft(["contract", "asset", "deploy", "--asset", "native", "--source", DEPLOYER, "--network", NETWORK]);
  const underlying = stellar(["contract", "id", "asset", "--asset", "native", "--network", NETWORK]);
  console.log(`underlying (native SAC) = ${underlying}`);

  // 2. Registries + verification keys.
  const verifier = deploy({ wasm: WASM.verifier }, ["--admin", deployerPub, "--manager", deployerPub]);
  console.log(`verifier = ${verifier}`);
  const auditor = deploy({ wasm: WASM.auditor }, ["--admin", deployerPub, "--manager", deployerPub]);
  console.log(`auditor = ${auditor}`);

  const client = new ChainClient({
    rpcUrl: RPC_URL,
    networkPassphrase: PASSPHRASE,
    contracts: { token: "", verifier, auditor },
  });

  for (const [name, circuitType] of VK_FILES) {
    const vk = readVk(name);
    await client.invoke(
      verifier,
      "register_verification_key",
      [
        xdr.ScVal.scvU32(circuitType),
        xdr.ScVal.scvBytes(Buffer.from(vk)),
        new Address(deployerPub).toScVal(),
      ],
      signer,
    );
    console.log(`  registered VK ${name} (circuit ${circuitType}, ${vk.length}B)`);
  }

  // 3. One auditor key (id 0). K_aud = k·H, not k·G: R_e = r_e·H, so only an
  //    H-multiple makes ecdh(k, R_e) = r_e·K_aud, the secret the sender used.
  const auditorSecret = randomScalar();
  const kAud = scalarMul(auditorSecret, H);
  await client.invoke(
    auditor,
    "register_key",
    [
      xdr.ScVal.scvU32(0),
      xdr.ScVal.scvBytes(Buffer.from(pointToBytes(kAud))),
      new Address(deployerPub).toScVal(),
    ],
    signer,
  );
  const kAudCoords = pointCoords(kAud);
  console.log(`  registered auditor key id 0`);

  // 4. The default token. Its wasm is uploaded once and reused by the factory.
  const vanillaToken = upload(WASM.vanillaToken);
  const ledgerBeforeToken = await client.latestLedger();
  const token = deploy({ hash: vanillaToken }, [
    "--underlying_asset", underlying,
    "--verifier", verifier,
    "--auditor", auditor,
  ]);
  console.log(`token = ${token}`);
  client.cfg.contracts.token = token;

  // 5. addr_f parity: compare the contract's emitted AddressAsField to the SDK.
  const sdkAddrF = addressToField(token);
  const onchainAddrF = await readAddressAsField(client, ledgerBeforeToken);
  if (onchainAddrF === null) {
    console.warn("  ! could not find AddressAsFieldSet event; skipping parity assert");
  } else if (onchainAddrF !== sdkAddrF) {
    throw new Error(
      `addr_f MISMATCH — SDK ${toHex32(sdkAddrF)} != contract ${toHex32(onchainAddrF)}. ` +
        `Poseidon2 implementations diverge; register proofs would fail.`,
    );
  } else {
    console.log(`  addr_f parity OK: ${toHex32(sdkAddrF)}`);
  }

  // 6. The shared factory for advanced mode. The browser only invokes
  //    factory.deploy_* (it never uploads wasm), so every kind it can create
  //    is uploaded here.
  const compliantToken = upload(WASM.compliantToken);
  const allowlist = upload(WASM.allowlist);
  const blocklist = upload(WASM.blocklist);
  const factory = deploy({ wasm: WASM.factory }, [
    "--token_wasm_hash", compliantToken,
    "--allowlist_wasm_hash", allowlist,
    "--vanilla_token_wasm_hash", vanillaToken,
    "--blocklist_wasm_hash", blocklist,
  ]);
  console.log(`factory = ${factory}`);

  const deployment: Deployment = {
    network: NETWORK,
    rpcUrl: RPC_URL,
    passphrase: PASSPHRASE,
    protocol: PROTOCOL,
    deployedAtLedger: ledgerBeforeToken,
    admin: deployerPub,
    kind: "vanilla",
    contracts: { token, verifier, auditor, underlying, factory },
    wasmHashes: { compliantToken, allowlist, vanillaToken, blocklist },
    auditor: {
      id: 0,
      secretHex: toHex32(auditorSecret),
      keyXHex: toHex32(kAudCoords.x),
      keyYHex: toHex32(kAudCoords.y),
    },
    addrF: toHex32(sdkAddrF),
  };
  saveDeployment(deployment);
  console.log(`\nwrote deployments/${NETWORK}.json`);
}

/** Scan token events for `address_as_field_set` and return its field value. */
async function readAddressAsField(client: ChainClient, fromLedger: number): Promise<bigint | null> {
  // Raw scan (the typed fetchEvents skips config events). One page suffices:
  // the setter event fires during construction, right after fromLedger.
  const resp = await client.server.getEvents({
    startLedger: fromLedger,
    filters: [{ type: "contract", contractIds: [client.cfg.contracts.token] }],
    limit: 50,
  });
  for (const ev of resp.events) {
    if (ev.topic[0]?.sym().toString() !== "address_as_field_set") continue;
    for (const entry of ev.value.map() ?? []) {
      if (entry.key().sym().toString() === "address_as_field") {
        return fromBytesBE(new Uint8Array(entry.val().bytes()));
      }
    }
  }
  return null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
