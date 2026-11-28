"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import styles from "../../../ui/page.module.css";
import type { Outcome } from "./messages";

interface Shown {
  show: (outcome: Outcome | null) => void;
}

const Results = createContext<Shown | null>(null);

export function useResults(): Shown {
  const shown = useContext(Results);
  if (!shown) throw new Error("Inbox forms must be inside InboxResults.");
  return shown;
}

export function InboxResults({ children, initial = null }: { children: ReactNode; initial?: Outcome | null }) {
  const [outcome, setOutcome] = useState<Outcome | null>(initial);
  const status = useRef<HTMLParagraphElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const show = useCallback((next: Outcome | null) => {
    setOutcome(next);
    if (next) queueMicrotask(() => (next.role === "alert" ? alert.current : status.current)?.focus());
  }, []);
  return (
    <Results.Provider value={{ show }}>
      <p ref={status} role="status" tabIndex={-1} className={styles.resultLine}>
        {outcome?.role === "status" ? outcome.text : ""}
      </p>
      <p ref={alert} role="alert" tabIndex={-1} className={`${styles.resultLine} ${styles.warning}`}>
        {outcome?.role === "alert" ? outcome.text : ""}
      </p>
      {children}
    </Results.Provider>
  );
}
