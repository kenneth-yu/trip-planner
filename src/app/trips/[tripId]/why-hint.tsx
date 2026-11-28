"use client";

import { useId, useState } from "react";
import styles from "./where-sleep.module.css";

export function WhyHint({ hint, why }: { hint: string; why: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <p className={styles.hint}>
        {hint}{" "}
        <button type="button" className={styles.why} aria-expanded={open} aria-controls={id} aria-label={`Why? ${hint}`} onClick={() => setOpen((o) => !o)}>
          Why?
        </button>
      </p>
      <p id={id} className={styles.hint} hidden={!open}>
        {why}
      </p>
    </div>
  );
}
