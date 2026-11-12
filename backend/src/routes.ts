import { Router, type Request, type Response } from "express";
import {
  registerAccount,
  depositTokens,
  confidentialTransfer,
  decryptSupplierPayments,
  auditAllTransfers,
  supplierAddress,
} from "./stellar.js";
import { appendPayment, getAllPayments } from "./store.js";
import { config } from "./config.js";

export const router = Router();

// ── POST /api/setup ──
router.post("/setup", async (_req: Request, res: Response) => {
  try {
    // Register both accounts (idempotent — stubs just log)
    await registerAccount(config.businessSecret);
    await registerAccount(config.supplierSecret);

    // Deposit starting balance for the business
    const startingAmount = 10_000;
    await depositTokens(config.businessSecret, startingAmount);

    res.json({ ok: true, message: `Setup complete. Deposited ${startingAmount} for business.` });
  } catch (err: any) {
    console.error("Setup error:", err);
    res.status(500).json({ error: err.message ?? "Setup failed" });
  }
});

// ── POST /api/pay ──
router.post("/pay", async (req: Request, res: Response) => {
  try {
    const { amount, invoiceNote } = req.body;

    if (!amount || typeof amount !== "number" || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }
    if (!invoiceNote || typeof invoiceNote !== "string" || !invoiceNote.trim()) {
      res.status(400).json({ error: "invoiceNote is required" });
      return;
    }

    // Always pay the supplier from .env
    const recipient = supplierAddress;

    const txHash = await confidentialTransfer(
      config.businessSecret,
      recipient,
      amount
    );

    // Persist record — amount is NOT stored (confidential)
    appendPayment({
      invoiceNote: invoiceNote.trim(),
      supplier: recipient,
      txHash,
      timestamp: new Date().toISOString(),
    });

    res.json({ txHash });
  } catch (err: any) {
    console.error("Pay error:", err);
    res.status(500).json({ error: err.message ?? "Payment failed" });
  }
});

// ── GET /api/supplier/payments ──
router.get("/supplier/payments", async (_req: Request, res: Response) => {
  try {
    // Decrypt amounts from chain
    const decrypted = await decryptSupplierPayments();

    // Join with stored invoice notes by txHash
    const stored = getAllPayments();
    const byHash = new Map(stored.map((p) => [p.txHash, p]));

    const result = decrypted.map((d) => {
      const record = byHash.get(d.txHash);
      return {
        amount: d.amount,
        invoiceNote: record?.invoiceNote ?? "",
        txHash: d.txHash,
        timestamp: record?.timestamp ?? "",
      };
    });

    res.json(result);
  } catch (err: any) {
    console.error("Supplier payments error:", err);
    res.status(500).json({ error: err.message ?? "Failed to fetch supplier payments" });
  }
});

// ── GET /api/auditor/ledger ──
router.get("/auditor/ledger", async (_req: Request, res: Response) => {
  try {
    const audited = await auditAllTransfers();

    // Join with stored invoice notes by txHash
    const stored = getAllPayments();
    const byHash = new Map(stored.map((p) => [p.txHash, p]));

    const ledger = audited.map((a) => ({
      date: a.date,
      supplier: a.supplier,
      amount: a.amount,
      invoiceNote: byHash.get(a.txHash)?.invoiceNote ?? "",
      txHash: a.txHash,
    }));

    res.json(ledger);
  } catch (err: any) {
    console.error("Auditor ledger error:", err);
    res.status(500).json({ error: err.message ?? "Failed to fetch auditor ledger" });
  }
});

// ── GET /api/auditor/export.csv ──
router.get("/auditor/export.csv", async (_req: Request, res: Response) => {
  try {
    const audited = await auditAllTransfers();
    const stored = getAllPayments();
    const byHash = new Map(stored.map((p) => [p.txHash, p]));

    const header = "date,supplier,amount,invoice note,tx hash";
    const rows = audited.map((a) => {
      const note = byHash.get(a.txHash)?.invoiceNote ?? "";
      // Escape CSV fields that might contain commas or quotes
      const escaped = (s: string) =>
        s.includes(",") || s.includes('"')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      return [a.date, a.supplier, String(a.amount), escaped(note), a.txHash].join(",");
    });

    const csv = [header, ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=privatepay-ledger.csv");
    res.send(csv);
  } catch (err: any) {
    console.error("CSV export error:", err);
    res.status(500).json({ error: err.message ?? "Failed to export CSV" });
  }
});
