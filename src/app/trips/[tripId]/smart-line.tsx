"use client";

import { useId, useState, type ReactNode } from "react";
import styles from "./smart-line.module.css";

export type SmartLineKind = "check" | "tip";

export interface SmartLineProps {
  kind: SmartLineKind;
  line: string;
  why: string;
  also?: string[];
  children?: ReactNode;
  defaultOpen?: boolean;
}

export function SmartLine({ kind, line, why, also = [], children, defaultOpen = false }: SmartLineProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panel = useId();
  return (
    <div className={`${styles.smart} ${kind === "check" ? styles.check : styles.tip}`} data-kind={kind}>
      <p className={styles.line}>
        {line}{" "}
        <button type="button" className={`quiet ${styles.why}`} aria-expanded={open} aria-controls={panel} aria-label={`Why? ${line}`} onClick={() => setOpen((was) => !was)}>
          Why?
        </button>
      </p>
      <div id={panel} hidden={!open} className={styles.panel}>
        <p>{why}</p>
        {also.length > 0 && (
          <p className={styles.also}>
            Also: {also.join(" ")}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
