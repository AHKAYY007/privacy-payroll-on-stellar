import { useState } from "react";
import Banner from "./components/Banner";
import PayTab from "./components/PayTab";
import SupplierTab from "./components/SupplierTab";
import AccountantTab from "./components/AccountantTab";

type Tab = "pay" | "supplier" | "accountant";

export default function App() {
  const [tab, setTab] = useState<Tab>("pay");

  return (
    <div className="app">
      <Banner />
      <header className="header">
        <h1>PrivatePay</h1>
        <p className="subtitle">Private supplier payments on Stellar</p>
      </header>
      <nav className="tabs">
        <button
          className={tab === "pay" ? "active" : ""}
          onClick={() => setTab("pay")}
        >
          Pay
        </button>
        <button
          className={tab === "supplier" ? "active" : ""}
          onClick={() => setTab("supplier")}
        >
          Supplier
        </button>
        <button
          className={tab === "accountant" ? "active" : ""}
          onClick={() => setTab("accountant")}
        >
          Accountant
        </button>
      </nav>
      <main className="content">
        {tab === "pay" && <PayTab />}
        {tab === "supplier" && <SupplierTab />}
        {tab === "accountant" && <AccountantTab />}
      </main>
    </div>
  );
}
