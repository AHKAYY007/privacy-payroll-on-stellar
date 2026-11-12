import type {
  PayRequest,
  PayResponse,
  SetupResponse,
  SupplierPayment,
  LedgerEntry,
} from "./types";

const BASE = "/api";

async function request<T>(
  url: string,
  opts?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    let msg: string;
    try {
      msg = JSON.parse(body).error ?? body;
    } catch {
      msg = body;
    }
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function setup(): Promise<SetupResponse> {
  return request<SetupResponse>("/setup", { method: "POST" });
}

export function pay(body: PayRequest): Promise<PayResponse> {
  return request<PayResponse>("/pay", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getSupplierPayments(): Promise<SupplierPayment[]> {
  return request<SupplierPayment[]>("/supplier/payments");
}

export function getAuditorLedger(): Promise<LedgerEntry[]> {
  return request<LedgerEntry[]>("/auditor/ledger");
}

export function getExportCsvUrl(): string {
  return `${BASE}/auditor/export.csv`;
}
