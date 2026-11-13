import { useState } from "react";
import Banner from "./components/Banner";
import PayTab from "./components/PayTab";
import SupplierTab from "./components/SupplierTab";
import AccountantTab from "./components/AccountantTab";
import WelcomePage from "./components/WelcomePage";

type View = "welcome" | "holder" | "supplier" | "auditor";

export default function App() {
  const [view, setView] = useState<View>("welcome");

  if (view === "welcome") {
    return (
      <>
        <Banner />
        <WelcomePage onLaunch={() => setView("holder")} />
      </>
    );
  }

  const modeTitle = {
    holder: "Account holder",
    supplier: "Supplier mode",
    auditor: "Auditor mode",
  }[view];

  return (
    <div className="workspace-shell">
      <Banner />
      <div className="workspace-layout">
        <aside className="workspace-rail">
          <button className="brand-lockup workspace-brand" onClick={() => setView("welcome")}>
            <span className="brand-mark" aria-hidden="true">P</span>
            <span>privatepay</span>
          </button>
          <div className="rail-rule" />
          <p className="rail-caption">PAYROLL DESK</p>
          <nav className="rail-nav" aria-label="Payroll workspace modes">
            <button className={view === "holder" ? "active" : ""} onClick={() => setView("holder")}>
              <span className="rail-glyph">↗</span><span>Account holder</span><span className="rail-arrow">→</span>
            </button>
            <button className={view === "supplier" ? "active" : ""} onClick={() => setView("supplier")}>
              <span className="rail-glyph">↓</span><span>Supplier view</span><span className="rail-arrow">→</span>
            </button>
            <button className={view === "auditor" ? "active" : ""} onClick={() => setView("auditor")}>
              <span className="rail-glyph">≡</span><span>Auditor view</span><span className="rail-arrow">→</span>
            </button>
          </nav>
          <div className="rail-spacer" />
          <div className="rail-network"><span className="network-status"><span /> Testnet connected</span><small>Stellar · Developer preview</small></div>
          <button className="rail-overview" onClick={() => setView("welcome")}>← Product overview</button>
        </aside>
        <div className="workspace-main">
          <header className="workspace-topbar">
            <div className="breadcrumb"><span>PRIVATEPAY</span><b>/</b><strong>{modeTitle}</strong></div>
            <span className="topbar-period">PAYROLL PERIOD <strong>NOV 2026</strong></span>
          </header>
          <main className="workspace-content">
            <div className="workspace-heading">
              <div>
                <p className="eyebrow">{view === "holder" ? "PAYMENTS & BALANCES" : view === "supplier" ? "SUPPLIER ACCOUNT" : "FINANCE CONTROL"}</p>
                <h1>{modeTitle}</h1>
                <p className="workspace-subtitle">
                  {view === "holder" && "Prepare and send confidential supplier payments."}
                  {view === "supplier" && "Review incoming supplier payments and invoice details."}
                  {view === "auditor" && "Review the recorded payroll ledger and export it for accounting."}
                </p>
              </div>
              <div className="mode-chip"><span>ACTIVE VIEW</span><strong>{view === "holder" ? "01" : view === "supplier" ? "02" : "03"}</strong></div>
            </div>
            <section className="workspace-panel">
              {view === "holder" && <PayTab />}
              {view === "supplier" && <SupplierTab />}
              {view === "auditor" && <AccountantTab />}
            </section>
          </main>
          <footer className="workspace-footer">
            <span>PRIVATEPAY <i>·</i> TESTNET PROTOTYPE</span>
            <span>CONFIDENTIAL TOKEN PREVIEW</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
