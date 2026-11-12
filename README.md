# PrivatePay

Private supplier payments for small businesses on Stellar testnet, using the Confidential Token SDK.

> ⚠️ **Testnet prototype. Contracts are an unaudited developer preview.**

## Setup

```bash
# 1. Install dependencies
npm run install:all

# 2. Configure environment
cp .env.example backend/.env
# Edit backend/.env with your contract IDs and testnet secret keys

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
| `BUSINESS_SECRET` | Testnet secret key for the business account |
| `SUPPLIER_SECRET` | Testnet secret key for the supplier account |
| `AUDITOR_SECRET` | Testnet secret key for the auditor account |

## Architecture

- **Backend** (`backend/`): Express + TypeScript. All confidential proving runs server-side. Payments are saved to `data/payments.json` (amounts are NOT stored — only invoice notes, supplier address, tx hash, and timestamp).
- **Frontend** (`frontend/`): Vite + React + TypeScript. Three tabs: Pay, Supplier, Accountant. Proxies `/api` requests to the backend.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/setup` | Register accounts + deposit starting balance |
| POST | `/api/pay` | Send a confidential payment |
| GET | `/api/supplier/payments` | Decrypted payments received by supplier |
| GET | `/api/auditor/ledger` | Full audited ledger |
| GET | `/api/auditor/export.csv` | CSV download of the ledger |
