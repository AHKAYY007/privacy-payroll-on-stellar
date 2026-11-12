import { useEffect, useState } from "react";
import { getAuditorLedger, getExportCsvUrl } from "../api";
import type { LedgerEntry } from "../types";

export default function AccountantTab() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLedger();
  }, []);

  async function loadLedger() {
    setLoading(true);
    setError(null);
    try {
      const data = await getAuditorLedger();
      setEntries(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const total = entries.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="tab-panel">
      <div className="panel-header">
        <div>
          <h2>Payroll ledger</h2>
          <p className="table-description">Only transfers recorded by this PrivatePay workspace are listed.</p>
        </div>
        <div className="panel-actions">
          <button onClick={loadLedger} disabled={loading} className="small">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <a href={getExportCsvUrl()} download className="btn small">
            Download CSV
          </a>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {!loading && entries.length === 0 && !error && (
        <p className="empty">No transfers recorded yet.</p>
      )}

      {entries.length > 0 && (
        <>
          <p className="total">
            Total paid: <strong>{total.toLocaleString()} XLM</strong>
          </p>
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Supplier</th>
                <th>Amount</th>
                <th>Invoice Note</th>
                <th>Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td>{e.date}</td>
                  <td className="hash" title={e.supplier}>
                    {e.supplier.slice(0, 8)}…
                  </td>
                  <td className="num">{e.amount}</td>
                  <td>{e.invoiceNote}</td>
                  <td className="hash">
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${e.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {e.txHash.slice(0, 8)}…
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
