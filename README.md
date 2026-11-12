# PrivatePay

Private supplier payments for small businesses on Stellar testnet, using the Confidential Token SDK.

> ⚠️ **Testnet prototype. Contracts are an unaudited developer preview.**

## Setup

```bash
# 1. Install dependencies
npm run install:all

# 2. Configure environment
cp .env.example backend/.env
# Edit backend/.env with contract IDs, the supplier secret, and auditor scalar

# 3. Start both backend and frontend
npm run dev
```

Backend runs on `http://localhost:3001`, frontend on `http://localhost:5173`.

## What goes in `.env`

| Variable | Description |
|---|---|
| `STELLAR_RPC_URL` | Stellar testnet RPC (`https://soroban-testnet.stellar.org`) |
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
| `TOKEN_CONTRACT_ID` | The SAC token contract ID on testnet |
| `CONFIDENTIAL_CONTRACT_ID` | The confidential wrapper contract ID on testnet |
| `SUPPLIER_NAME` | Display name for the configured supplier (default `Emeka Supplies`) |
| `SUPPLIER_ADDRESS` | Public G-address of the supplier account, registered through Freighter |
| `SUPPLIER_SECRET` | Optional testnet secret key if the backend should register/decrypt for the supplier |
| `AUDITOR_GRUMPKIN_SECRET_HEX` | Grumpkin scalar whose public key is registered for `AUDITOR_ID` |
| `AUDITOR_ID` | Auditor registry ID used by the connected payer and supplier (default `0`) |
| `TOKEN_DEPLOYED_AT_LEDGER` | Deployment ledger for the confidential token, used for initial event sync |

Install and enable Freighter, switch it to Stellar Testnet, and fund the selected account with test XLM before pressing **Connect & Set Up**. Freighter signs the account's key-derivation messages, confidential registration, deposits, merges, and payments. The connected payer's secret key is never read by the backend. Register the supplier account through Freighter and set its public address in `SUPPLIER_ADDRESS`; alternatively, configure `SUPPLIER_SECRET` for backend-managed supplier registration and decryption.

Payment amounts entered in the UI are XLM and are converted to stroops for contract calls. The browser stores reconstructed wallet state in localStorage; treat this browser profile as sensitive. Supplier and auditor event scans use Soroban RPC, whose event history is limited to roughly seven days, so this demo does not provide complete historical audit data after that window.

## Architecture

- **Backend** (`backend/`): Express + TypeScript. Serves public network settings, registers the configured supplier, persists invoice metadata (never amounts), and powers supplier/auditor views.
- **Frontend** (`frontend/`): Vite + React + TypeScript. Freighter connects and signs payer operations; confidential proofs are generated in the browser. The landing screen launches the Account holder workspace, with Supplier and Auditor modes available from its view switcher.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/config` | Public chain settings and configured supplier address |
| POST | `/api/setup` | Register the configured supplier account |
| POST | `/api/payments` | Save invoice metadata after the wallet submits a payment |
| GET | `/api/supplier/payments` | Decrypted payments received by supplier |
| GET | `/api/auditor/ledger` | Audited ledger for payments recorded by this workspace |
| GET | `/api/auditor/export.csv` | CSV download of this workspace's ledger |
