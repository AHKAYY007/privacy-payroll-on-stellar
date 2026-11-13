import { Router, type Request, type Response } from "express";
import {
  ensureSupplierAccount,
  auditAllTransfers,
  supplierAddress,
} from "./stellar.js";
import { appendPayment, getAllPayments, getRecentPayments } from "./store.js";
import { toCsv } from "./csv.js";
import { config } from "./config.js";

export const router = Router();

router.get("/config", (_req: Request, res: Response) => {
  res.json({
    rpcUrl: config.stellarRpcUrl,
    networkPassphrase: config.stellarPassphrase,
    tokenContractId: config.confidentialContractId,
    verifierContractId: config.verifierContractId,
    auditorContractId: config.auditorContractId,
    auditorId: config.auditorId,
    deployedAtLedger: config.tokenDeployedAtLedger,
    supplierAddress,
    supplierName: config.supplierName,
  });
});

// ── POST /api/setup ──
router.post("/setup", async (_req: Request, res: Response) => {
  try {
    // The payer registers from Freighter in the browser. Supplier mode can
    // register the configured recipient from the supplier's own Freighter.
    await ensureSupplierAccount();
    res.json({
      ok: true,
      message: "Supplier address is configured.",
      supplierAddress,
      supplierName: config.supplierName,
    });
  } catch (err: any) {
    console.error("Setup error:", err);
    const message = String(err?.message ?? err);
    const missingAccount = message.match(/Account not found:\s*(G[A-Z2-7]+)/i);
    if (missingAccount) {
      const address = missingAccount[1];
      res.status(400).json({
        error: `Stellar account ${address} does not exist on this testnet. Fund it with test XLM using https://friendbot.stellar.org/?addr=${address}, then run setup again.`,
        supplierAddress,
      });
      return;
    }
    res.status(500).json({ error: message || "Setup failed" });
  }
});

// ── POST /api/payments ──
router.get("/payments", (_req: Request, res: Response) => {
  res.json(getRecentPayments());
});

router.post("/payments", (req: Request, res: Response) => {
  try {
    const { txHash, invoiceNote } = req.body;
    if (typeof txHash !== "string" || !/^[a-fA-F0-9]{64}$/.test(txHash)) {
      res.status(400).json({ error: "txHash must be a 64-character transaction hash" });
      return;
    }
    if (!invoiceNote || typeof invoiceNote !== "string" || !invoiceNote.trim()) {
      res.status(400).json({ error: "invoiceNote is required" });
      return;
    }

    appendPayment({
      invoiceNote: invoiceNote.trim(),
      supplier: supplierAddress,
      txHash,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ ok: true });
  } catch (err: any) {
    console.error("Payment record error:", err);
    res.status(500).json({ error: err.message ?? "Failed to save payment details" });
  }
});

// ── GET /api/auditor/ledger ──
router.get("/auditor/ledger", async (_req: Request, res: Response) => {
  try {
    const audited = await auditAllTransfers();

    // Join with stored invoice notes by txHash
    const stored = getAllPayments();
    const byHash = new Map(stored.map((p) => [p.txHash, p]));

    const ledger = audited.filter((payment) => byHash.has(payment.txHash)).map((a) => {
      const record = byHash.get(a.txHash);
      return {
        date: record?.timestamp ?? a.date,
        supplier: a.supplier,
        amount: a.amount,
        invoiceNote: record?.invoiceNote ?? "",
        txHash: a.txHash,
      };
    });

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

    const rows = audited.filter((payment) => byHash.has(payment.txHash)).map((a) => {
      const record = byHash.get(a.txHash);
      const date = record?.timestamp ?? a.date;
      const note = record?.invoiceNote ?? "";
      return [date, a.supplier, String(a.amount), note, a.txHash];
    });

    const csv = toCsv([
      ["date", "supplier", "amount", "invoice note", "tx hash"],
      ...rows,
    ]);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=privatepay-ledger.csv");
    res.send(csv);
  } catch (err: any) {
    console.error("CSV export error:", err);
    res.status(500).json({ error: err.message ?? "Failed to export CSV" });
  }
});
