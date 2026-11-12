import { useState } from "react";
import { pay, setup } from "../api";

const EXPLORER = "https://stellar.expert/explorer/testnet/tx/";

// The supplier address is served by the backend; for the dropdown label
// we just show a truncated version.
const SUPPLIER_LABEL = "Supplier (from .env)";

export default function PayTab() {
  const [amount, setAmount] = useState("");
  const [invoiceNote, setInvoiceNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSetup() {
    setSetupLoading(true);
    setError(null);
    try {
      await setup();
      setSetupDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSetupLoading(false);
    }
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    if (!invoiceNote.trim()) {
      setError("Enter an invoice note.");
      return;
    }
    setLoading(true);
    setError(null);
    setTxHash(null);
    try {
      // supplier address is resolved server-side from .env
      const res = await pay({
        supplier: "env",
        amount: amt,
        invoiceNote: invoiceNote.trim(),
      });
      setTxHash(res.txHash);
      setAmount("");
      setInvoiceNote("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tab-panel">
      {!setupDone && (
        <div className="setup-box">
          <p>
            First-time setup: register accounts and deposit starting balance.
          </p>
          <button onClick={handleSetup} disabled={setupLoading}>
            {setupLoading ? "Setting up…" : "Run Setup"}
          </button>
        </div>
      )}

      <form onSubmit={handlePay} className="pay-form">
        <label>
          Supplier
          <select disabled>
            <option>{SUPPLIER_LABEL}</option>
          </select>
        </label>

        <label>
          Amount
          <input
            type="number"
            min="1"
            step="1"
            placeholder="e.g. 500"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={loading}
          />
        </label>

        <label>
          Invoice note
          <input
            type="text"
            placeholder="e.g. Nov office supplies"
            value={invoiceNote}
            onChange={(e) => setInvoiceNote(e.target.value)}
            disabled={loading}
          />
        </label>

        <button type="submit" disabled={loading} className="primary">
          {loading ? "Sending…" : "Send privately"}
        </button>
      </form>

      {error && <div className="error-msg">{error}</div>}

      {txHash && (
        <div className="success-msg">
          <p>
            ✅ Payment sent!{" "}
            <a
              href={`${EXPLORER}${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Explorer →
            </a>
          </p>
          <p className="hint">
            The explorer shows both addresses but <strong>not</strong> the
            amount — it's encrypted on-chain.
          </p>
        </div>
      )}
    </div>
  );
}
