# Confidential Token Demo (Stellar)

A working demo of a **confidential token on Stellar**: balances are Pedersen commitments on the Grumpkin curve, and every state transition is proven with an UltraHonk zero-knowledge proof verified on-chain. On top of the token sit two compliance channels: **dual auditor** ciphertexts (a master-key auditor can decrypt every transfer) and off-chain **selective disclosure** (a holder proves one amount of one transfer to one designated receiver). Built on OpenZeppelin's [`stellar-confidential`](https://github.com/OpenZeppelin/stellar-contracts/tree/v0.8.0/packages/confidential) 0.8.0 contracts and the [`stellar-confidential-token-sdk`](https://github.com/brozorec/stellar-confidential-token-sdk) TypeScript SDK.

> ⚠️ **Not production ready.** The UltraHonk verifier backend and the circuits are unaudited. Testnet only; do not use with real value.

## What it does

Amounts and balances are never revealed on-chain. A balance is a commitment `C = v·G + r·H`; the network only ever sees commitments and ZK proofs that the arithmetic is correct (no overspend, conserved value, correct ownership).

Each account holds two balances:

- a **spendable** balance (what you can send/withdraw), and
- a **receiving** balance (where deposits and incoming transfers land).

`merge` folds receiving into spendable (a homomorphic point add). Operations:

| Op | Proof? | Effect |
|----|--------|--------|
| `register` | ✔ | Bind your Grumpkin keys to the contract |
| `deposit` | — | Move public SEP-41 tokens → your receiving balance |
| `merge` | — | Fold receiving → spendable |
| `withdraw` | ✔ | Spendable → public SEP-41 tokens |
| `confidential_transfer` | ✔ | Spendable → another account's receiving |

Transfers also emit dual auditor ciphertexts (sender + recipient channels), so a designated auditor holding the registered Grumpkin key can decrypt amounts (the SDK ships the decryption side, and the app has an auditor console).

The protocol also has a spender role (`set_spender` / `confidential_transfer_from` / `revoke_spender`) and, on compliant tokens, `clawback`. The app does not initiate those, but the wallet and the auditor console decode their events.

The app's landing page is a persona chooser:

- **Account holder** (`/wallet`) — connect Freighter, run the five operations with proofs generated in the browser.
- **Disclosure receiver** (`/verify`) — issue a one-time disclosure request, verify the returned proof against the chain. No wallet needed.
- **Auditor** (`/auditor`) — decrypt transfer amounts with the registered auditor key.
- **Token admin** (`/admin`) — shown for a token you deployed in advanced mode: grant the compliance roles, freeze/unfreeze accounts, and manage the allowlist or blocklist.

**Advanced mode** (`/advanced`, via the nav's deployment switcher) deploys your own token through the shared factory, in one of four kinds: vanilla, compliant (freeze only), compliant + allowlist, or compliant + blocklist. The app then serves that token instead of the default one.

## Getting started

### Basic

The fastest way to get a feel for confidential tokens is to make a private transfer on testnet. The contracts are already deployed on testnet. (see [Deployed](#deployed-testnet)).

Options:

**A.** Open the [live demo](https://stellar-confidential-token-demo.billowing-moon-0c6f.workers.dev/), install the [Freighter](https://freighter.app/) browser wallet, switch it to **Testnet**, and fund your account with test XLM (Freighter's built-in Friendbot button, or [Stellar Lab → Fund account](https://lab.stellar.org/account/fund)).

**B.** Clone and run locally (see [Prerequisites](#prerequisites)):
```bash
git clone https://github.com/brozorec/stellar-confidential-token-demo
cd stellar-confidential-token-demo
pnpm install                 # also compiles the SDK (its `prepare` script)
pnpm dev                     # http://localhost:3000
```

Either way, the app opens on the persona chooser. As the **account holder** (`/wallet`), proofs are generated in the browser (~1s each):

1. **Connect Freighter**, then **Register** — derives your confidential keys and binds them to the contract.
2. **Deposit** — move public XLM into your *receiving* balance.
3. **Merge** — fold the receiving balance into your *spendable* balance.
4. **Transfer** — send to another registered account's receiving balance.
5. **Withdraw** — convert spendable back to public XLM.

Then try the other two personas: **/verify** (a disclosure receiver verifies that one transfer paid them exactly X) and **/auditor** (decrypt transfer amounts with the registered auditor key).

### Advanced

To compile the contracts, deploy your own contracts, or drive the whole flow from scripts:

```bash
pnpm install
pnpm build:contracts        # stellar contract build → contracts/out/*.wasm
(cd contracts && cargo test)

# Testnet (uses the `admin` stellar CLI identity as deployer):
pnpm deploy:contracts
pnpm e2e                    # register → deposit → merge → transfer → withdraw
pnpm e2e:disclosure         # disclosure proving + receiver verification over a real event
pnpm e2e:advanced           # every factory kind + the admin flows

pnpm dev                    # run the Next.js demo app locally
```

The SDK's own test suite (crypto parity, proving, disclosure) and the disclosure circuits' sources live in the [SDK repo](https://github.com/brozorec/stellar-confidential-token-sdk#build--test), not here.

This demo wraps the protocol end to end; the protocol itself is OpenZeppelin's `stellar-confidential` crate, which `contracts/` consume from crates.io (pinned to `=0.8.0`).

- [Confidential token module](https://github.com/OpenZeppelin/stellar-contracts/tree/v0.8.0/packages/confidential): the on-chain logic for `register` / `deposit` / `merge` / `withdraw` / `confidential_transfer`, the spender role and clawback, plus the protocol and SDK specifications under `docs/`.
- [Noir circuits](https://github.com/OpenZeppelin/stellar-contracts/tree/v0.8.0/packages/confidential/circuits): the on-chain circuits and the shared `lib` whose generators, hashes, and derivations the SDK's crypto mirrors exactly.
- [Contract examples](https://github.com/OpenZeppelin/stellar-contracts/tree/v0.8.0/examples/confidential): the verifier, auditor, compliant token, allowlist policy and factory, vendored verbatim into `contracts/`.
- [UltraHonk verifier](https://github.com/NethermindEth/rs-soroban-ultrahonk): the proof-verification backend the verifier contract runs (maintained by Nethermind).

## Architecture

```
contracts/                    Rust/Soroban (separate Cargo workspace, stellar-confidential 0.8.0)
  vanilla-token/              ConfidentialToken (NoHooks) — the default token          [demo]
  verifier/                   UltraHonk VK registry (verify_proof)                     [upstream]
  auditor/                    Grumpkin auditor-key registry                            [upstream]
  compliant-token/            token + freezer / config_manager / clawback roles        [upstream]
  allowlist-policy/           membership policy the compliant token consults           [upstream]
  blocklist-policy/           the allowlist's counterpart                              [demo]
  factory/                    upstream factory + vanilla/blocklist kinds, append-only  [upstream+demo]
packages/
  app/        @ctd/app        Next.js demo front-end (Freighter wallet)
  indexer/    @ctd/indexer    Goldsky indexer to ingest events and a handler API to read stored events
scripts/                      build-contracts.sh · deploy.ts · e2e*.ts (testnet) · vendor-bb.mjs
```

`[upstream]` crates are the `stellar-confidential` 0.8.0 examples, vendored verbatim; `[demo]` crates are this repo's own.

The client SDK is the external [`stellar-confidential-token-sdk`](https://github.com/brozorec/stellar-confidential-token-sdk) package (crypto · witness · proving · chain · state · auditor · disclosure). It is a git dependency pinned to a commit, and it also ships the circuit artifacts, the VKs that `deploy.ts` registers, and the pinned disclosure VKs (the off-chain trust anchor).

Each package has its own README:

- [`@ctd/app`](packages/app/README.md) — the Next.js demo front-end: browser proving, cross-origin isolation, the bb.js vendoring rule, Cloudflare deploy.
- [`@ctd/indexer`](packages/indexer/README.md) — the optional Goldsky indexer and its read API.

## RPC retention vs. indexer history

The protocol's spendable secrets (`v`, `r`) live only in events — the chain stores commitments, not openings — and the Soroban RPC serves only ~7 days of history. The client reconstructs balances from a hybrid event source (RPC for the recent tail, an optional Goldsky indexer for older history) and persists decrypted openings locally, re-checking them against the on-chain commitments. With RPC alone that local persistence is load-bearing: sync at least once per retention window, or an aged-out incoming-transfer opening becomes unrecoverable.

The reconstruction mechanics live in the [SDK](https://github.com/brozorec/stellar-confidential-token-sdk#state-reconstruction--retention); enabling the indexer in the app is covered in [`@ctd/app`](packages/app/README.md#event-history--the-indexer).

## Deployed (testnet)

`deployments/testnet.json` (regenerate with `pnpm deploy:contracts`), deployed at ledger 5371973 on `stellar-confidential` 0.8.0:

| Contract | ID |
|----------|----|
| token (vanilla) | `CA642WUED6PACAQGVKSXND3DRSXGR7DP2L7TRHZORPWEPNRVGGN4L4ED` |
| verifier | `CAN45PFA5CVUCU3JB77IE2JNWNTRCDWMRNG55U452L3N2IOCAGOLTUVQ` |
| auditor | `CBQZRK72Y6KJ5DR4CUHKLHMHIKBMOZNSYTWHRUQPEXA35PRCBMSPBZTW` |
| factory | `CAWPCXMW47UET5Z4N5T44PRDGAY6CZVP2O2JDEBL7YWEUHJGQ2BR4L6R` |
| underlying | native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

## Prerequisites

- Node ≥ 20, pnpm 10
- For rebuilding contracts: Rust stable + `wasm32v1-none` (pinned by `contracts/rust-toolchain.toml`) and `stellar` CLI ≥ 28.1.0. Build through `pnpm build:contracts`, not `cargo build`: soroban-sdk 28's `build.rs` refuses any wasm build that `stellar contract build` did not start. The OpenZeppelin crates come from crates.io, pinned to `=0.8.0`.
- Nothing here regenerates circuit artifacts. They ship with the SDK package (compiled with `nargo` 1.0.0-beta.11 and `bb` 0.87.0), and the SDK repo rebuilds them.

## License

MIT.
