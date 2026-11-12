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
    <div className="workspace-app">
      <Banner />
      <header className="workspace-topbar">
        <button className="brand-lockup workspace-brand" onClick={() => setView("welcome")}>
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>privatepay</span>
        </button>
        <div className="workspace-topbar-right">
          <span className="network-status"><span /> Stellar Testnet</span>
          <span className="topbar-divider" />
          <span className="mode-label">{modeTitle}</span>
        </div>
      </header>
      <main className="workspace-content">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">PAYROLL WORKSPACE</p>
            <h1>{modeTitle}</h1>
            <p className="workspace-subtitle">
              {view === "holder" && "Prepare and send confidential supplier payments."}
              {view === "supplier" && "Review incoming supplier payments and invoice details."}
              {view === "auditor" && "Review the recorded payroll ledger and export it for accounting."}
            </p>
          </div>
          <label className="mode-switch-label">
            <span>View in</span>
            <select value={view} onChange={(event) => setView(event.target.value as View)}>
              <option value="holder">Account holder mode</option>
              <option value="supplier">Supplier mode</option>
              <option value="auditor">Auditor mode</option>
            </select>
          </label>
        </div>
        <nav className="workspace-nav" aria-label="Payroll workspace modes">
          <button className={view === "holder" ? "active" : ""} onClick={() => setView("holder")}>
            Account holder
          </button>
          <button className={view === "supplier" ? "active" : ""} onClick={() => setView("supplier")}>
            Supplier view
          </button>
          <button className={view === "auditor" ? "active" : ""} onClick={() => setView("auditor")}>
            Auditor view
          </button>
        </nav>
        <section className="workspace-panel">
          {view === "holder" && <PayTab />}
          {view === "supplier" && <SupplierTab />}
          {view === "auditor" && <AccountantTab />}
        </section>
      </main>
      <footer className="workspace-footer">
        <span>PrivatePay · Testnet prototype</span>
        <button onClick={() => setView("welcome")}>Back to overview</button>
      </footer>
    </div>
  );
}
