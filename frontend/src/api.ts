import type {
  LedgerEntry,
  PaymentHistoryEntry,
  PublicAppConfig,
  SetupResponse,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data: unknown = await response.json();

  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data as T;
}

export function getPublicConfig(): Promise<PublicAppConfig> {
  return request<PublicAppConfig>("/config");
}

export function setup(): Promise<SetupResponse> {
  return request<SetupResponse>("/setup", { method: "POST" });
}

export function recordPayment(txHash: string, invoiceNote: string): Promise<void> {
  return request<void>("/payments", {
    method: "POST",
    body: JSON.stringify({ txHash, invoiceNote }),
  });
}

export function getPaymentHistory(): Promise<PaymentHistoryEntry[]> {
  return request<PaymentHistoryEntry[]>("/payments");
}

export function getAuditorLedger(): Promise<LedgerEntry[]> {
  return request<LedgerEntry[]>("/auditor/ledger");
}

export function getExportCsvUrl(): string {
  return "/api/auditor/export.csv";
}