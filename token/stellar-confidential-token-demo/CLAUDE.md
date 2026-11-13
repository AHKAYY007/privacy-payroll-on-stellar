# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A full-stack demo of a confidential token system on Stellar using Soroban smart contracts and client-side UltraHonk zero-knowledge proofs. It is built on OpenZeppelin's `stellar-confidential` 0.8.0 crate (crates.io) and the external `stellar-confidential-token-sdk` TypeScript package. This repo holds the Rust contracts, the Next.js browser app, the deploy/e2e scripts and an optional Goldsky indexer; the SDK lives in its own repo.

## Commands

```bash
# Install dependencies. Also compiles the SDK's dist/ (its `prepare` script),
# which pnpm runs only because the SDK is in pnpm.onlyBuiltDependencies.
pnpm install

# Build contracts (Rust → WASM, into contracts/out/) and refresh the factory's
# testdata wasms
pnpm build:contracts

# Contract unit tests
cd contracts && cargo test

# Start dev server (auto-vendors bb.js via predev hook)
pnpm dev

# Type-check the app
pnpm --filter @ctd/app typecheck

# Deploy the demo to testnet: verifier (+ VKs), auditor (+ key), the default
# vanilla token, and the advanced-mode superset factory. Writes
# deployments/testnet.json. Deployer is the `admin` stellar CLI identity.
pnpm deploy:contracts

# Full end-to-end workflow tests on testnet
pnpm e2e
pnpm e2e:disclosure
pnpm e2e:advanced     # every factory kind + the admin/role flows

# Deploy the app to Cloudflare Workers
pnpm deploy:app
```

The Cloudflare Git build command is `pnpm --filter @ctd/app run build:cf`. There
is no separate SDK build step any more; `pnpm install` builds it.

Scripts run as `tsx scripts/<x>.ts` from the root (root devDependencies: `tsx`,
`@stellar/stellar-sdk`, the SDK). The root `package.json` must stay
`"type": "module"`: the SDK's exports map has only an `import` condition.

The SDK's test suite (crypto parity, proving, disclosure, indexer parity) lives
in the SDK repo, not here. The only test in this repo outside `contracts/` is
`pnpm --filter @ctd/indexer test:live`, which hits a live indexer and SKIPs
unless `CTD_INDEXER_URL` and `CTD_TOKEN` are both set.

After a redeploy, `deployments/testnet.json` is the only file the script
updates — `packages/app/lib/deployment.ts` (`DEFAULT_DEPLOYMENT`: contract ids
including `factory`, `deployedAtLedger`, and the regenerated `auditorSecretHex`)
and the README's deployment table are hand-maintained copies.

## The SDK dependency

`stellar-confidential-token-sdk` is a git dependency pinned to a commit
(`github:brozorec/stellar-confidential-token-sdk#<sha>`) in both the root and
`packages/app` `package.json`. Bump both together.

- Import from the package root or its exported subpaths only:
  `/proving/artifacts` (`loadCircuit`, Node), `/state/json-store`
  (`JsonFileStore`, Node), and `/circuits/*` (circuit JSON, `vks/*.vk.bin`,
  `disclosure/*`). Deep `src/` imports fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- The package ships the circuit artifacts and the VKs that `deploy.ts`
  registers, so the contracts, the SDK pin and the deployment move together.
  The disclosure artifacts and pinned VKs are the off-chain trust anchor: the
  prover and the `/verify` receiver load the same files.
- For co-development, point the dependency at a local checkout with `file:` or
  `pnpm.overrides`, never `link:`. A `link:` doesn't install the SDK's own
  dependencies into this store, so `vendor-bb.mjs` can't find bb.js and the app
  gets two `@stellar/stellar-sdk` copies.

What the SDK provides, by layer:

1. **crypto** — Grumpkin EC, Poseidon2 hash, key derivation. Keys are contract-bound: `vk = Poseidon2(VIEWING_KEY, sk, addr_f)` so keys from one deployment are useless on another.
2. **witness** — Builds circuit inputs for `register`, `withdraw`, `transfer`, `set_spender` and `spender_transfer`, plus the off-chain `disclose-recipient` / `disclose-sender` circuits.
3. **proving** — `CircuitProver` calls bb.js `prove()` with witness bytes. Returns 14,592-byte UltraHonk proofs using keccak256 Fiat–Shamir transcripts (mandatory: the on-chain verifier is also keccak). On-chain circuits use the non-ZK flavour; disclosure provers must be `new CircuitProver(artifact, { zk: true })`.
4. **chain** — `ChainClient` wraps `@stellar/stellar-sdk`; submitters encode `{payload, proof}` for contract args; `factory`/`admin` helpers for the upstream factory, roles and allowlist.
5. **state** — `StateEngine` replays events to reconstruct `{v, r}` openings and ends every `sync()` with an on-chain check (`StateDivergedError` / `StateUnverifiedError`). Build proof witnesses from `spendableForProof()`. Uses `LocalStorageStore` in the browser or `JsonFileStore` in Node. The store is load-bearing: receiving openings become unrecoverable after RPC event retention (~7 days on testnet) unless persisted locally.
6. **auditor**, **disclosure** — single-event auditor decryption; the D-recipient / D-sender selective-disclosure protocol (holder and receiver sides).

## Architecture

### Monorepo layout

```
contracts/          # Soroban Rust workspace (stellar-confidential =0.8.0, soroban-sdk 28)
packages/app/       # @ctd/app — Next.js browser demo
packages/indexer/   # @ctd/indexer — Goldsky pipeline + Cloudflare Worker read API
scripts/            # build-contracts.sh, deploy.ts, e2e.ts, e2e-disclosure.ts,
                    #   e2e-advanced.ts, vendor-bb.mjs, _shared.ts
deployments/        # Generated testnet.json (git-ignored)
```

### Contracts

Build through `pnpm build:contracts` (`stellar contract build`), never plain
`cargo build`: soroban-sdk 28's `build.rs` aborts any wasm build the stellar CLI
didn't start. Outputs are `contracts/out/confidential_<crate>_example.wasm`.

- **verifier**, **auditor**, **compliant-token**, **allowlist-policy** — upstream `examples/confidential/*` from stellar-contracts tag `v0.8.0`, vendored verbatim. Keep them verbatim.
- **vanilla-token** — demo-owned `ConfidentialToken` with `NoHooks`: no admin, no freeze, no clawback. The default token. A compliant token with no policy is not equivalent: its admin can grant itself `freezer` + `clawback`.
- **blocklist-policy** — demo-owned AccessControl policy `(admin, manager)`, the allowlist's counterpart.
- **factory** — the upstream factory extended append-only with `deploy_vanilla_token`, `deploy_blocklist`, `deploy_blocklist_and_token` and their `predict_*`. The new kinds hash a kind `Symbol` into the salt, so a blocklist can't land on an allowlist's address.

Protocol facts that have cost time: the compliant token's constructor grants no
roles (`freezer`/`config_manager`/`clawback` each need a `grant_role`); freeze
does not gate `register` (only the policy and the SAC do); on an allowlist token
a holder must be allowed before `register`. Auditor keys must be `k·H`, not `G`.

### App (`packages/app/`)

- **lib/wallet.ts** — `ConfidentialWallet` orchestrates the SDK; manages prover cache and Freighter signing.
- **lib/derive-key.ts** — `sk` from a SEP-53 Freighter signature via the SDK's `deriveSk`, with the signer-root obligations (verify, sign twice, never persist the root).
- **lib/demo-contracts.ts** — helpers for what the SDK doesn't know: the factory's vanilla/blocklist functions and the blocklist policy.
- **lib/deployment.ts**, **lib/active-deployment.tsx** — the built-in default deployment and the advanced-mode slot; a saved slot from another `PROTOCOL` is dropped on load.
- **lib/bb-loader.ts** — Overrides SDK's default bb.js loader to load from `/vendor/bb/index.js` (native ESM, not bundled).
- **next.config.mjs** — Sets `COOP: same-origin` + `COEP: credentialless` headers (required for SharedArrayBuffer / Web Worker). Aliases `@aztec/bb.js` → `false` in the client webpack bundle; `transpilePackages` the SDK.
- **public/_headers** — COOP/COEP/CORP for `/vendor/bb/*` on Cloudflare, where static assets bypass `next.config.mjs` headers.

## Critical: bb.js Must Never Be Webpack-Bundled

bb.js collides with webpack's module runtime and its Web Worker sibling files won't be found if chunked under `/_next/`. The fix is already in place:

1. `scripts/vendor-bb.mjs` (run by `predev`/`prebuild`/`prebuild:cf`) copies bb.js's browser bundle to `public/vendor/bb/` (git-ignored). It resolves bb.js through the SDK and refuses any version but `VERSIONS.toolchain.bbJs`.
2. The webpack client config aliases `@aztec/bb.js` to `false`.
3. The app's bb-loader imports `/vendor/bb/index.js` as native ESM at runtime.

If you see a blank page or proving that hangs silently, the likely cause is bb.js being bundled.

## Cross-Origin Isolation

The app requires `window.crossOriginIsolated === true` for SharedArrayBuffer (used by bb.js's Web Worker). `COEP: credentialless` (not `require-corp`) is intentional — it allows the RPC fetch without needing CORS headers on the Stellar testnet endpoint.

## State Reconstruction Caveat

Testnet RPC retention is ~120,960 ledgers (~7 days). Receiving balance is a running sum of crediting events, so an opening whose event ages out before the client syncs is permanently lost — the chain stores commitments, not openings.

Two mitigations, both in the SDK's `chain/event-source.ts` (`hybridFetchEvents`):
- The local store persists decrypted openings, re-checked against the on-chain commitments.
- An **optional** Goldsky indexer (`packages/indexer/`, enabled via `NEXT_PUBLIC_INDEXER_URL`) serves history older than the RPC window. It is consulted *only* when the requested start ledger predates the live retention floor; the indexer owns `[next, seam-1]` and RPC owns `[seam, head]`, disjoint by construction. A failed backfill deliberately fails the whole sync rather than letting the RPC leg's cursor persist and strand pre-window history forever.

With no indexer configured the client is RPC-only, and the local store becomes load-bearing: sync at least once per retention window.
