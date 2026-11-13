import { useEffect, useState } from "react";
import { getPaymentHistory, getPublicConfig, recordPayment, setup } from "../api";
import { ConfidentialWallet, getConnectedWallet } from "../wallet";
import type { PaymentHistoryEntry, PublicAppConfig } from "../types";

const EXPLORER = "https://stellar.expert/explorer/testnet/tx/";

export default function PayTab() {
  const [amount, setAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("100");
  const [invoiceNote, setInvoiceNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [setupDone, setSetupDone] = useState(() => getConnectedWallet() !== null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [wallet, setWallet] = useState<ConfidentialWallet | null>(() => getConnectedWallet());
  const [walletAddress, setWalletAddress] = useState<string | null>(() => getConnectedWallet()?.address ?? null);
  const [appConfig, setAppConfig] = useState<PublicAppConfig | null>(null);
  const [balance, setBalance] = useState({ spendable: 0, receiving: 0 });
  const [walletBusy, setWalletBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [history, setHistory] = useState<PaymentHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getPaymentHistory()
      .then((payments) => {
        if (active) setHistory(payments);
      })
      .catch((e: unknown) => {
        if (active) setHistoryError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    getPublicConfig()
      .then(async (config) => {
        if (!active) return;
        setAppConfig(config);
        const connectedWallet = getConnectedWallet();
        if (connectedWallet) {
          setWallet(connectedWallet);
          setWalletAddress(connectedWallet.address);
          setSetupDone(true);
          setBalance(await connectedWallet.refresh());
        }
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSetup() {
    setSetupLoading(true);
    setError(null);
    setNotice("Connect Freighter and approve the key-derivation signature prompts.");
    try {
      const config = appConfig ?? await getPublicConfig();
      await setup();
      const connectedWallet = wallet ?? getConnectedWallet() ?? await ConfidentialWallet.connect(config);
      setAppConfig(config);
      setWallet(connectedWallet);
      setWalletAddress(connectedWallet.address);
      setNotice("Approve the confidential account registration in Freighter.");
      await connectedWallet.register();
      setBalance(await connectedWallet.refresh());
      setSetupDone(true);
      setNotice("Wallet connected and confidential account ready.");
    } catch (e: any) {
      setError(e.message);
      setNotice(null);
    } finally {
      setSetupLoading(false);
    }
  }

  async function handleDeposit() {
    if (!wallet) return;
    setWalletBusy(true);
    setError(null);
    setNotice("Approve the XLM deposit in Freighter.");
    try {
      await wallet.deposit(depositAmount);
      setBalance(await wallet.refresh());
      setNotice("Deposit complete. Merge the receiving balance to make it spendable.");
    } catch (e: any) {
      setError(e.message);
      setNotice(null);
    } finally {
      setWalletBusy(false);
    }
  }

  async function handleMerge() {
    if (!wallet) return;
    setWalletBusy(true);
    setError(null);
    setNotice("Approve the merge transaction in Freighter.");
    try {
      await wallet.merge();
      setBalance(await wallet.refresh());
      setNotice("Receiving funds merged into your spendable balance.");
    } catch (e: any) {
      setError(e.message);
      setNotice(null);
    } finally {
      setWalletBusy(false);
    }
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet || !appConfig) {
      setError("Connect and set up Freighter before sending a payment.");
      return;
    }
    if (!invoiceNote.trim()) {
      setError("Enter an invoice note.");
      return;
    }
    setLoading(true);
    setError(null);
    setNotice("Proving the confidential transfer. Freighter will ask you to sign it next.");
    setTxHash(null);
    try {
      const submittedHash = await wallet.pay(appConfig.supplierAddress, amount);
      setTxHash(submittedHash);
      setAmount("");
      try {
        await recordPayment(submittedHash, invoiceNote.trim());
        setInvoiceNote("");
        setNotice("Payment sent and invoice note saved.");
        setHistory(await getPaymentHistory());
      } catch {
        setNotice("Payment was sent, but its invoice note could not be saved. Keep the transaction hash below.");
        setHistoryError("This payment's invoice note was not saved to the local ledger.");
      }
      setBalance(await wallet.refresh());
    } catch (e: any) {
      setError(e.message);
      setNotice(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tab-panel">
      <div className="setup-box">
        <div>
          <p>Connect Freighter on Stellar Testnet. Registration, deposits, merges, and payments are signed by your wallet.</p>
          {walletAddress && <p className="wallet-address">Connected: {walletAddress}</p>}
          {notice && <p className="wallet-notice">{notice}</p>}
        </div>
        <button onClick={handleSetup} disabled={setupLoading || setupDone}>
          {setupLoading ? "Connecting…" : setupDone ? "Wallet ready" : "Connect & Set Up"}
        </button>
      </div>

      {wallet && setupDone && (
        <section className="wallet-funds" aria-label="Confidential wallet balance">
          <div className="wallet-balance">
            <span>Spendable</span>
            <strong>{balance.spendable.toLocaleString()} XLM</strong>
          </div>
          <div className="wallet-balance">
            <span>Receiving</span>
            <strong>{balance.receiving.toLocaleString()} XLM</strong>
          </div>
          <label>
            Deposit XLM
            <input
              type="number"
              min="0.0000001"
              step="0.0000001"
              value={depositAmount}
              onChange={(event) => setDepositAmount(event.target.value)}
              disabled={walletBusy || loading}
            />
          </label>
          <button onClick={handleDeposit} disabled={walletBusy || loading}>
            {walletBusy ? "Waiting for Freighter…" : "Deposit"}
          </button>
          <button onClick={handleMerge} disabled={walletBusy || loading || balance.receiving <= 0}>
            Merge receiving
          </button>
        </section>
      )}

      <form onSubmit={handlePay} className="pay-form">
        <div className="payment-form-heading">
          <div>
            <p className="eyebrow">NEW PAYMENT</p>
            <h2>Prepare a supplier payment</h2>
            <p>Invoice details stay with your records. The transfer amount is encrypted on-chain.</p>
          </div>
          <div className="privacy-seal" aria-label="Confidential amount">
            <span>AMOUNT</span>
            <strong>PRIVATE</strong>
          </div>
        </div>
        <label>
          Supplier
          <select disabled>
            <option>
              {appConfig
                ? appConfig.supplierAddress
                  ? `${appConfig.supplierName} · ${appConfig.supplierAddress}`
                  : "Set SUPPLIER_ADDRESS in backend/.env"
                : "Loading supplier…"}
            </option>
          </select>
        </label>

        <label>
          Amount
          <input
            className="amount-entry"
            type="number"
            min="0.0000001"
            step="0.0000001"
            placeholder="e.g. 50"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={loading || !setupDone}
          />
        </label>

        <label>
          Invoice note
          <input
            type="text"
            placeholder="e.g. Nov office supplies"
            value={invoiceNote}
            onChange={(e) => setInvoiceNote(e.target.value)}
            disabled={loading || !setupDone}
          />
        </label>

        <button type="submit" disabled={loading || !setupDone} className="primary">
          {loading ? "Proving and signing…" : "Send privately"}
        </button>
        <div className="payment-form-footnote">
          <span className="lock-glyph" aria-hidden="true">◈</span>
          <span>Only the connected account can authorize this transfer.</span>
        </div>
      </form>

      {error && <div className="error-msg">{error}</div>}

      {walletAddress && error?.includes(walletAddress) && error.includes("Account not found") && (
        <p className="hint">
          Fund the connected wallet with test XLM: <a href={`https://friendbot.stellar.org/?addr=${walletAddress}`} target="_blank" rel="noreferrer">open Friendbot</a>
        </p>
      )}

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

      <section className="payment-history" aria-labelledby="payment-history-title">
        <div className="history-heading">
          <div>
            <p className="eyebrow">RECENT ACTIVITY</p>
            <h2 id="payment-history-title">Transaction history</h2>
          </div>
          <span className="history-count">{history.length.toString().padStart(2, "0")} RECORDS</span>
        </div>
        {historyError && <p className="history-message">{historyError}</p>}
        {historyLoading ? (
          <p className="history-message">Loading saved payments…</p>
        ) : history.length === 0 ? (
          <p className="history-message">No payments recorded yet. Completed payments will appear here.</p>
        ) : (
          <div className="table-wrap history-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th>Invoice note</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {history.map((payment) => (
                  <tr key={payment.txHash}>
                    <td>{new Date(payment.timestamp).toLocaleString()}</td>
                    <td>{appConfig?.supplierName ?? "Supplier"}</td>
                    <td>{payment.invoiceNote}</td>
                    <td className="hash">
                      <a href={`${EXPLORER}${payment.txHash}`} target="_blank" rel="noopener noreferrer">
                        {payment.txHash.slice(0, 8)}…{payment.txHash.slice(-6)} ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="history-privacy-note">Amounts are intentionally omitted from this off-chain activity list.</p>
      </section>
    </div>
  );
}
