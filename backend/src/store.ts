import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface PaymentRecord {
  invoiceNote: string;
  supplier: string;
  txHash: string;
  timestamp: string;
}

const DATA_FILE = path.resolve("data", "payments.json");

function ensureDir() {
  const dir = path.dirname(DATA_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function read(): PaymentRecord[] {
  if (!existsSync(DATA_FILE)) return [];
  const raw = readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(raw) as PaymentRecord[];
}

function write(records: PaymentRecord[]) {
  ensureDir();
  writeFileSync(DATA_FILE, JSON.stringify(records, null, 2));
}

export function appendPayment(record: PaymentRecord) {
  const records = read();
  records.push(record);
  write(records);
}

export function getAllPayments(): PaymentRecord[] {
  return read();
}

export function getRecentPayments(limit = 20): PaymentRecord[] {
  return read().slice(-limit).reverse();
}
