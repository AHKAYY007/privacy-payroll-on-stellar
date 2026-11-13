/* ── Types matching backend API responses ── */

export interface PublicAppConfig {
  rpcUrl: string;
  networkPassphrase: string;
  tokenContractId: string;
  verifierContractId: string;
  auditorContractId: string;
  auditorId: number;
  deployedAtLedger: number;
  supplierAddress: string;
  supplierName: string;
}

export interface SetupResponse {
  ok: boolean;
  message: string;
  supplierAddress: string;
  supplierName: string;
}

export interface LedgerEntry {
  date: string;
  supplier: string;
  amount: number;
  invoiceNote: string;
  txHash: string;
}

export interface PaymentHistoryEntry {
  invoiceNote: string;
  supplier: string;
  txHash: string;
  timestamp: string;
}

export interface ReceivedPayment extends PaymentHistoryEntry {
  amount: number;
}
