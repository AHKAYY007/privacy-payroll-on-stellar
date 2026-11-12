/* ── Types matching backend API responses ── */

export interface PayRequest {
  supplier: string;
  amount: number;
  invoiceNote: string;
}

export interface PayResponse {
  txHash: string;
}

export interface SetupResponse {
  ok: boolean;
  message: string;
}

export interface SupplierPayment {
  amount: number;
  invoiceNote: string;
  txHash: string;
  timestamp: string;
}

export interface LedgerEntry {
  date: string;
  supplier: string;
  amount: number;
  invoiceNote: string;
  txHash: string;
}
