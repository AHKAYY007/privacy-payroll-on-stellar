# PrivatePay Implementation Status

Private supplier payments on Stellar Testnet using Freighter and the Confidential Token SDK.

## Frontend
- [x] Payroll landing screen launches the Account holder workspace; Supplier and Auditor are explicit modes.
- [x] Testnet warning banner.
- [x] Connect Freighter, require Stellar Testnet, verify SEP-53 signatures, and derive account-bound confidential keys.
- [x] Register the connected payer with a proof signed/submitted through Freighter.
- [x] Deposit and merge XLM through wallet-signed transactions; show spendable and receiving balances.
- [x] Build confidential transfer proofs in the browser and submit payments through Freighter.
- [x] Preserve invoice notes without persisting payment amounts; show transaction hash and testnet explorer link.
- [x] Load pinned bb.js worker assets from a stable public path with COOP/COEP headers.

## Backend
- [x] Express API serves public deployment settings and the configured supplier address.
- [x] Setup verifies the supplier recipient; it does not sign as the payer.
- [x] No payer private key is read from `.env`; transaction signing is handled by Freighter.
- [x] Store invoice note, supplier address, transaction hash, and timestamp only; never store amount.
- [x] Supplier endpoint decrypts incoming payments; auditor endpoint decrypts app-recorded transfer events and exports CSV.
- [x] CSV escaping covers commas, quotes, and embedded newlines.
- [x] Retry a transaction once on `txBadSeq`.

## SDK Integration
- [x] SDK is pinned to commit `aad17069714713bcb36fa376d0f2a87743e8e2a7`.
- [x] Initialize `ChainClient` from public backend settings.
- [x] Derive payer keys from two verified, matching Freighter SEP-53 signatures.
- [x] Persist wallet state in browser localStorage and reconstruct spendable openings from recent events.
- [x] Prove registration and transfer in-browser; Freighter signs each submitted payer transaction.
- [x] Support a public supplier address registered by the supplier wallet; optional backend supplier secret enables server-side registration/decryption.
- [x] Validate the configured Grumpkin auditor secret against the registered on-chain auditor public key.

## Verification
- [x] Frontend production build.
- [x] Backend TypeScript check.
- [x] Browser prover assets are vendored before dev/build and COOP/COEP are enabled.
- [x] Root `npm run dev` starts both services and public config responds.
- [ ] End-to-end setup, deposit, merge, and payment with funded Freighter and supplier testnet accounts.
- [ ] Confirm payment amount is not visible in the on-chain transaction/event data.
- [ ] CSV export against live ledger data; requires a successful testnet transfer.

## Remaining Setup
- Configure valid testnet contract IDs, `SUPPLIER_ADDRESS`, and `AUDITOR_GRUMPKIN_SECRET_HEX` in `backend/.env`; add `SUPPLIER_SECRET` only when server-side supplier registration/decryption is desired.
- Fund the connected Freighter account and configured supplier Stellar account with test XLM.
- Enable Freighter on Stellar Testnet. RPC event history is limited to roughly seven days unless an indexer is configured.
- No automated tests were added, per project request.
