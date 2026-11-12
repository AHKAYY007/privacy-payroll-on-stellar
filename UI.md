Build a minimal hackathon prototype called "PrivatePay": private supplier payments for small businesses on Stellar TESTNET only, using the Confidential Token SDK. Keep it small. No auth, no database beyond a JSON file, no extra features.

STACK
- Backend: Node + TypeScript + Express.
- Frontend: Vite + React + TypeScript, plain CSS, three screens.
- Network: Stellar testnet (RPC https://soroban-testnet.stellar.org, passphrase "Test SDF Network ; September 2015").
- Dependencies: stellar-confidential-token-sdk (install from github:brozorec/stellar-confidential-token-sdk, pinned to commit aad17069714713bcb36fa376d0f2a87743e8e2a7) and @stellar/stellar-sdk pinned to ^14.2.0 so only one copy is installed.

IMPORTANT RULES
- Do NOT guess the SDK's API. Read the SDK's README and source in node_modules, and the OpenZeppelin doc "Build with the SDK (testnet)" at docs.openzeppelin.com/stellar-contracts/tokens/confidential/build-with-the-sdk. The SDK exports ChainClient, submitRegister, submitDeposit, submitMerge, submitTransfer, submitWithdraw, fetchEvents, auditTransfer, JsonFileStore, loadCircuit, randomScalar, auditorPublicKey and pointToBytes. Use them as documented.
- All confidential and proving logic runs in the backend only. The browser never touches proving code.
- Read the token contract ID, confidential wrapper contract ID, and the three demo secret keys (business, supplier, auditor) from a .env file. Never hardcode them. Include a .env.example.
- Back-to-back transactions from one account can fail with txBadSeq on testnet. Wait for each transaction to confirm and retry once on txBadSeq.
- Add a visible banner on every screen: "Testnet prototype. Contracts are an unaudited developer preview."

BACKEND ENDPOINTS
- POST /api/setup: register the business and supplier accounts if not already registered, then deposit a starting amount for the business.
- POST /api/pay: body { supplier, amount, invoiceNote }. Runs the confidential transfer from the business to the supplier, waits for confirmation, then saves { invoiceNote, supplier, txHash, timestamp } to a JSON file. The amount itself is NOT stored in that file.
- GET /api/supplier/payments: decrypts and returns payments received by the supplier, with amounts.
- GET /api/auditor/ledger: uses the auditor key with fetchEvents and auditTransfer to decrypt all transfers and joins them with the saved invoice notes.
- GET /api/auditor/export.csv: the same ledger as a CSV download with columns date, supplier, amount, invoice note, tx hash.

FRONTEND (three tabs)
1. Pay: supplier dropdown (the supplier address from .env, labelled), amount, invoice note, "Send privately" button. After sending, show the tx hash with a link to the Stellar testnet explorer and a short line explaining that the explorer shows both addresses but not the amount.
2. Supplier: table of received payments with amounts and invoice notes.
3. Accountant: full ledger table, total paid, and a "Download CSV" button.
Show loading states and readable error messages. Keep the design clean and simple.

DELIVERABLES
- Working local setup with one command to start both backend and frontend.
- A short README with setup steps and what to put in .env.
- Do not add anything beyond what is listed above.