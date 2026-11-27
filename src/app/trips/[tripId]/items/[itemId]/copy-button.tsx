"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./item.module.css";

type State = "idle" | "copied" | "failed";

export function CopyButton({ value, what }: { value: string; what: string }) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <span className={styles.copyWrap}>
      <button type="button" className={styles.copy} aria-label={`Copy ${what}`} onClick={copy}>
        {state === "copied" ? "Copied" : "Copy"}
      </button>
      <span role="status" className={state === "failed" ? styles.copyFailed : styles.srOnly}>
        {state === "copied" ? "Copied" : state === "failed" ? "Could not copy. Press and hold the code to copy it." : ""}
      </span>
    </span>
  );
}
