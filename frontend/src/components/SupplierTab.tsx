import { useEffect, useState } from "react";
import { getPaymentHistory, getPublicConfig } from "../api";
import { ConfidentialWallet, getConnectedWallet } from "../wallet";
import type { PaymentHistoryEntry, PublicAppConfig, ReceivedPayment } from "../types";

export default function SupplierTab() {
  const [payments, setPayments] = useState<ReceivedPayment[]>([]);
  const [history, setHistory] = useState<PaymentHistoryEntry[]>([]);
  const [appConfig, setAppConfig] = useState<PublicAppConfig | null>(null);
  const [wallet, setWallet] = useState<ConfidentialWallet | null>(() => getConnectedWallet("supplier"));
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getPublicConfig(), getPaymentHistory()])
      .then(async ([config, records]) => {
        if (!active) return;
        setAppConfig(config);
        setHistory(records);
        const connected = getConnectedWallet("supplier");
        if (connected && connected.address === config.supplierAddress) {
          setWallet(connected);
          setLoading(true);
          try {
            setPayments(await connected.receivedPayments(records));
          } catch (e) {
            if (active) setError(e instanceof Error ? e.message : String(e));
          } finally {
            if (active) setLoading(false);
          }
        }
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  async function connectSupplier() {
    setConnecting(true);
    setError(null);
    try {
      const config = appConfig ?? await getPublicConfig();
      if (!config.supplierAddress) {
        throw new Error("Supplier address is not configured. Set SUPPLIER_ADDRESS in backend/.env.");
      }
      const connected = await ConfidentialWallet.connect(config, "supplier");
      if (connected.address !== config.supplierAddress) {
        throw new Error("The connected Freighter account does not match the configured supplier address.");
      }
      setAppConfig(config);
      setWallet(connected);
      await connected.register();
      const records = await getPaymentHistory();
      setHistory(records);
      setLoading(true);
      setPayments(await connected.receivedPayments(records));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setConnecting(false);
    }
  }

  async function refreshPayments() {
    if (!wallet) return;
    setLoading(true);
    setError(null);
    try {
      const records = await getPaymentHistory();
      setHistory(records);
      setPayments(await wallet.receivedPayments(records));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tab-panel">
      <div className="panel-header">
        <div>
          <h2>Incoming payments</h2>
          <p className="table-description">
            Connect the supplier wallet to register if needed and decrypt incoming amounts in this browser.
          </p>
        </div>
        {wallet ? (
          <button onClick={refreshPayments} disabled={loading} className="small">
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        ) : (
          <button onClick={connectSupplier} disabled={connecting || !appConfig?.supplierAddress} className="small">
            {connecting ? "Connecting…" : "Connect supplier wallet"}
          </button>
        )}
      </div>

      {wallet && <p className="wallet-address">Connected supplier: {wallet.address}</p>}
      {error && <div className="error-msg">{error}</div>}
      {loading && <p className="empty">Decrypting recorded incoming transfers…</p>}
      {!loading && !wallet && !error && (
        <p className="empty">Connect the supplier’s Freighter account to view incoming amounts.</p>
      )}
      {!loading && wallet && payments.length === 0 && !error && (
        <p className="empty">No recorded payments received by this supplier yet.</p>
      )}

      {!loading && payments.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Invoice note</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.txHash}>
                  <td>{payment.timestamp.startsWith("Ledger ") ? payment.timestamp : new Date(payment.timestamp).toLocaleString()}</td>
                  <td className="num">{payment.amount.toLocaleString()} XLM</td>
                  <td>{payment.invoiceNote}</td>
                  <td className="hash">
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${payment.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {payment.txHash.slice(0, 8)}… ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
