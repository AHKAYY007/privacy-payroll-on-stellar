import { useEffect, useState } from "react";
import { getSupplierPayments } from "../api";
import type { SupplierPayment } from "../types";

export default function SupplierTab() {
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPayments();
  }, []);

  async function loadPayments() {
    setLoading(true);
    setError(null);
    try {
      const data = await getSupplierPayments();
      setPayments(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tab-panel">
      <div className="panel-header">
        <h2>Received Payments</h2>
        <button onClick={loadPayments} disabled={loading} className="small">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {!loading && payments.length === 0 && !error && (
        <p className="empty">No payments received yet.</p>
      )}

      {payments.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>Invoice Note</th>
              <th>Tx Hash</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p, i) => (
              <tr key={i}>
                <td>{new Date(p.timestamp).toLocaleString()}</td>
                <td className="num">{p.amount}</td>
                <td>{p.invoiceNote}</td>
                <td className="hash">
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${p.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {p.txHash.slice(0, 8)}…
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
