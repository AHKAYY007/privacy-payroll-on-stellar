"use client";

/**
 * Tracks which deployment the app is serving and persists the user-created
 * "advanced" one in localStorage.
 *
 * Two slots only (per product decision): the built-in {@link DEFAULT_DEPLOYMENT}
 * and a single "advanced" deployment created by the advanced-mode wizard.
 * Deploying a new confidential token overwrites the advanced slot. The selector
 * in the nav toggles which one is active; every persona page reads
 * {@link useActiveDeployment}().active and builds its ChainClient / wallet from
 * it, so switching rewires the whole app.
 *
 * Hydration: the provider renders the default on the server and on first client
 * paint, then restores the persisted choice in an effect. A brief flash to the
 * advanced deployment is acceptable for the demo and avoids an SSR mismatch.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_DEPLOYMENT, PROTOCOL, type Deployment } from "./deployment";
import { sweepStaleDefaultKeys, type StaleSweep } from "./stale-keys";

const ADVANCED_KEY = "ctd:advanced:deployment";
const ACTIVE_KEY = "ctd:active"; // "default" | "advanced"

type Which = "default" | "advanced";

interface ActiveDeploymentCtx {
  /** The deployment currently in effect (default unless advanced is active). */
  active: Deployment;
  /** The saved advanced deployment, or null if none has been created. */
  advanced: Deployment | null;
  which: Which;
  /** Switch the active slot (no-op to "advanced" when none exists). */
  setWhich: (w: Which) => void;
  /** Persist a freshly-deployed advanced deployment and switch to it. */
  saveAdvanced: (d: Deployment) => void;
  /** Forget the advanced deployment and fall back to the default. */
  clearAdvanced: () => void;
  /**
   * Set once per load when the default token turned out to have been redeployed
   * and this browser's cached keys for the old one were evicted. The wallet page
   * surfaces it so a wiped balance is explained rather than mysterious.
   */
  staleSweep: StaleSweep | null;
  /** Dismiss the redeploy notice (both causes) for this session. */
  dismissStaleSweep: () => void;
  /**
   * Set once per load when a saved advanced deployment was dropped because it
   * predates the current protocol release or factory.
   */
  droppedAdvanced: boolean;
}

const Ctx = createContext<ActiveDeploymentCtx | null>(null);

/**
 * The saved advanced deployment, or "stale" when it was dropped. A token from
 * another protocol release or factory fails event decoding from both RPC and
 * the indexer (`missing field "r_e_point"`), so it can't be served.
 */
function loadAdvanced(): Deployment | "stale" | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(ADVANCED_KEY);
  if (!raw) return null;
  let d: Deployment;
  try {
    d = JSON.parse(raw) as Deployment;
  } catch {
    return null;
  }
  if (d.protocol === PROTOCOL && d.contracts?.factory === DEFAULT_DEPLOYMENT.contracts.factory) return d;
  localStorage.removeItem(ADVANCED_KEY);
  localStorage.setItem(ACTIVE_KEY, "default");
  return "stale";
}

export function ActiveDeploymentProvider({ children }: { children: React.ReactNode }) {
  const [advanced, setAdvanced] = useState<Deployment | null>(null);
  const [which, setWhichState] = useState<Which>("default");
  const [staleSweep, setStaleSweep] = useState<StaleSweep | null>(null);
  const [droppedAdvanced, setDroppedAdvanced] = useState(false);

  useEffect(() => {
    const loaded = loadAdvanced();
    // Only a positive result is recorded: the second strict-mode run finds the
    // slot already removed.
    if (loaded === "stale") setDroppedAdvanced(true);
    const adv = loaded === "stale" ? null : loaded;
    if (adv) setAdvanced(adv);
    if (localStorage.getItem(ACTIVE_KEY) === "advanced" && adv) setWhichState("advanced");
    // Runs after the advanced slot is known so a live advanced token is spared.
    // The sweep is a one-shot: it updates the marker, so a repeat call reports
    // nothing. Only a positive result is recorded, or React's double-invoked
    // effects in dev (reactStrictMode) would immediately clear the notice.
    const sweep = sweepStaleDefaultKeys(
      DEFAULT_DEPLOYMENT.contracts.token,
      adv?.contracts.token ?? null,
    );
    if (sweep) setStaleSweep(sweep);
  }, []);

  const dismissStaleSweep = useCallback(() => {
    setStaleSweep(null);
    setDroppedAdvanced(false);
  }, []);

  const setWhich = useCallback((w: Which) => {
    setWhichState(w);
    try {
      localStorage.setItem(ACTIVE_KEY, w);
    } catch {
      /* ignore */
    }
  }, []);

  const saveAdvanced = useCallback((d: Deployment) => {
    try {
      localStorage.setItem(ADVANCED_KEY, JSON.stringify(d));
      localStorage.setItem(ACTIVE_KEY, "advanced");
    } catch {
      /* ignore */
    }
    setAdvanced(d);
    setWhichState("advanced");
  }, []);

  const clearAdvanced = useCallback(() => {
    try {
      localStorage.removeItem(ADVANCED_KEY);
      localStorage.setItem(ACTIVE_KEY, "default");
    } catch {
      /* ignore */
    }
    setAdvanced(null);
    setWhichState("default");
  }, []);

  const active = which === "advanced" && advanced ? advanced : DEFAULT_DEPLOYMENT;

  return (
    <Ctx.Provider
      value={{
        active,
        advanced,
        which,
        setWhich,
        saveAdvanced,
        clearAdvanced,
        staleSweep,
        dismissStaleSweep,
        droppedAdvanced,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useActiveDeployment(): ActiveDeploymentCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useActiveDeployment must be used within ActiveDeploymentProvider");
  return ctx;
}
