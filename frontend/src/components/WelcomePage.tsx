interface WelcomePageProps {
  onLaunch: () => void;
}

export default function WelcomePage({ onLaunch }: WelcomePageProps) {
  return (
    <main className="welcome-page">
      <header className="welcome-nav">
        <a className="brand-lockup" href="#home" aria-label="PrivatePay home">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>privatepay</span>
        </a>
        <span className="network-status"><span /> Stellar Testnet</span>
      </header>

      <section className="welcome-hero">
        <div className="welcome-copy">
          <p className="eyebrow">PRIVATE PAYROLL · STELLAR</p>
          <h1>Pay suppliers.<br /><em>Keep amounts private.</em></h1>
          <p className="welcome-description">
            A focused payroll workspace for sending confidential supplier payments,
            keeping invoice records, and giving your accountant a clear audit trail.
          </p>
          <button className="launch-button" onClick={onLaunch}>
            Open payroll workspace <span aria-hidden="true">↗</span>
          </button>
          <p className="welcome-footnote">No account creation required. Connect Freighter inside the workspace.</p>
        </div>

        <div className="payroll-preview" aria-label="PrivatePay payroll overview preview">
          <div className="preview-topline">
            <div>
              <span className="preview-kicker">THIS MONTH</span>
              <strong>Supplier payroll</strong>
            </div>
            <span className="preview-period">NOV 2026</span>
          </div>
          <div className="preview-total">
            <span>Confidential transfers</span>
            <div><strong>••••••</strong><span className="private-pill">PRIVATE</span></div>
          </div>
          <div className="preview-rule" />
          <div className="preview-row">
            <span className="supplier-avatar">ES</span>
            <span className="preview-vendor"><strong>Emeka Supplies</strong><small>Invoice 204 · Materials</small></span>
            <span className="preview-amount">•••• XLM</span>
          </div>
          <div className="preview-row">
            <span className="supplier-avatar slate">LL</span>
            <span className="preview-vendor"><strong>Lagos Logistics</strong><small>Invoice 198 · Delivery</small></span>
            <span className="preview-amount">•••• XLM</span>
          </div>
          <div className="preview-bottom">
            <span className="verified-mark">✓</span>
            <span>Recorded on Stellar</span>
            <span className="preview-bottom-tail">Amounts encrypted</span>
          </div>
        </div>
      </section>

      <section className="welcome-details" aria-label="Workspace capabilities">
        <article>
          <span className="detail-index">01</span>
          <div><h2>Confidential by design</h2><p>Payment amounts stay encrypted on-chain. Your wallet signs every payment.</p></div>
        </article>
        <article>
          <span className="detail-index">02</span>
          <div><h2>Invoices stay attached</h2><p>Keep supplier names and invoice notes alongside each transaction record.</p></div>
        </article>
        <article>
          <span className="detail-index">03</span>
          <div><h2>Audit when needed</h2><p>View the payroll ledger in auditor mode, with amounts decrypted for review.</p></div>
        </article>
      </section>
      <footer className="welcome-footer">
        <span>PrivatePay</span>
        <span>Testnet prototype · unaudited developer preview</span>
      </footer>
    </main>
  );
}
