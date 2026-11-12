# PrivatePay Implementation TODO & Status Tracker

This tracker maps the exact tasks, current status, stubs, and remaining integration steps for the PrivatePay hackathon prototype on Stellar Testnet.

---

## 1. Frontend Status
- [x] **Project Structure**: Vite + React 18 + TypeScript + plain CSS setup.
- [x] **Warning Banner**: Visible on every screen ("Testnet prototype. Contracts are an unaudited developer preview.").
- [x] **Tab 1: Pay Screen**:
  - [x] Supplier dropdown (labelled with supplier from `.env`).
  - [x] Amount input.
  - [x] Invoice note input.
  - [x] "Send privately" submission button with loading state.
  - [x] Explorer link displaying transaction hash (`https://stellar.expert/explorer/testnet/tx/...`).
  - [x] Privacy reminder noting both addresses are visible on-chain while amount remains encrypted.
- [x] **Tab 2: Supplier Screen**:
  - [x] Table listing decrypted received payments (Date, Amount, Invoice Note, Tx Hash).
  - [x] Refresh button and empty state handling.
- [x] **Tab 3: Accountant Screen**:
  - [x] Full audit ledger table (Date, Supplier, Amount, Invoice Note, Tx Hash).
  - [x] Cumulative total paid calculation.
  - [x] "Download CSV" button linked to `/api/auditor/export.csv`.
- [x] **Proving Logic Isolation**: Zero zero-knowledge proving logic in browser bundle.

---

## 2. Backend Architecture & API Routes Status
- [x] **Express App & Middleware**: CORS, JSON parser, error handling.
- [x] **Environment Variable Configuration**: Strict validation for RPC URL, Network Passphrase, Contract IDs, and Secrets.
- [x] **Local JSON Store (`backend/data/payments.json`)**:
  - [x] Schema: `{ invoiceNote, supplier, txHash, timestamp }`.
  - [x] Amount is intentionally excluded from local disk storage.
- [x] **API Endpoints Wire-up**:
  - [x] `POST /api/setup`: Business & supplier registration, initial business deposit.
  - [x] `POST /api/pay`: Runs transfer, awaits confirmation, saves record without amount.
  - [x] `GET /api/supplier/payments`: Fetches decrypted supplier payments joined with stored notes.
  - [x] `GET /api/auditor/ledger`: Fetches audited transfers via auditor key joined with stored notes.
  - [x] `GET /api/auditor/export.csv`: Generates downloadable CSV (date, supplier, amount, invoice note, tx hash).
- [x] **Sequence Mismatch Handling**: `withRetry` logic to catch `txBadSeq` and retry once after delay.

---

## 3. Stellar Confidential Token SDK Integration Status (Current Focus)

The SDK (`stellar-confidential-token-sdk` @ `aad17069714713bcb36fa376d0f2a87743e8e2a7`) is installed in `backend/`. The stubs in `backend/src/stellar.ts` are to be replaced with concrete SDK calls:

- [ ] **SDK Initialization & Circuit Loading**:
  - Import `loadCircuit` from `stellar-confidential-token-sdk/proving/artifacts`.
  - Initialize `ChainClient` with `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE`, and `CONFIDENTIAL_CONTRACT_ID`.
  - Instantiate `CircuitProver` for `register`, `transfer`, `withdraw`.
- [ ] **State & Key Derivation**:
  - Derive encryption/proving keys for Business, Supplier, and Auditor using `deriveKeys` / `deriveSk`.
  - Configure `JsonFileStore` (from `stellar-confidential-token-sdk/state/json-store`) or `StateEngine` for tracking balance commitments and spendable openings `(v, r)`.
- [ ] **Stub Replacement: `registerAccount`**:
  - Build register witness using `buildRegisterWitness`.
  - Generate UltraHonk proof.
  - Execute `submitRegister(client, signer, account, auditorId, witness, proof)`.
- [ ] **Stub Replacement: `depositTokens`**:
  - Execute `submitDeposit(client, signer, from, to, amount)`.
  - Sync state engine to recognize new incoming balance / execute `submitMerge` if necessary.
- [ ] **Stub Replacement: `confidentialTransfer`**:
  - Reconstruct sender spendable state `(v, r)` via `StateEngine.spendableForProof()`.
  - Build transfer witness using `buildTransferWitness` with recipient public key, auditor public key (`auditorPublicKey`), amount, and random blinding factors (`randomScalar`).
  - Generate transfer proof.
  - Execute `submitTransfer(client, signer, from, to, witness, proof)`.
  - Return transaction hash.
- [ ] **Stub Replacement: `decryptSupplierPayments`**:
  - Fetch contract events via `fetchEvents(client, contractId)` or state synchronizer.
  - Filter transfer events directed to supplier address.
  - Decrypt encrypted balance / incoming amounts using supplier private viewing key (`auditTransferRecipientChannel` or receiver decryptor).
- [ ] **Stub Replacement: `auditAllTransfers`**:
  - Ingest transfer events using `fetchEvents`.
  - Decrypt audit ciphertext using `auditTransfer(event, auditorSecret)` with auditor private key.
  - Return decrypted entries `[{ date, supplier, amount, txHash }]`.

---

## 4. Verification & Testing Checklist
- [ ] End-to-end dry run with valid Stellar Testnet keys and funded testnet accounts.
- [ ] Validate Explorer links and verify amount confidentiality on-chain.
- [ ] Validate CSV download integrity.
- [ ] Ensure single-command start works seamlessly (`npm run dev`).
