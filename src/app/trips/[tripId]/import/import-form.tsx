"use client";

import { useEffect, useId, useRef, useState } from "react";
import pageStyles from "../../../ui/page.module.css";
import styles from "./import.module.css";

export interface DateDefaults {
  from: string | null;
  to: string | null;
}

export function ProblemAlert({ text }: { text: string }) {
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    alert.current?.focus();
  }, [text]);
  return (
    <p ref={alert} role="alert" tabIndex={-1} className={pageStyles.warning}>
      {text}
    </p>
  );
}

export function ImportForm({ action, kind, defaults }: { action: string; kind: "file" | "link"; defaults: DateDefaults }) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const hasDates = defaults.from !== null || defaults.to !== null;
  const datesHint = hasDates ? "Events outside these dates are left out." : "Leave empty to bring in every event.";
  const sourceHint = kind === "file" ? "An .ics file, up to 2 MB." : "Starts with https:// or webcal://. The app reads it once and does not keep it.";
  return (
    <form method="post" action={action} encType="multipart/form-data" onSubmit={() => setPending(true)} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor={`${id}-source`}>{kind === "file" ? "Calendar file" : "Calendar link"}</label>
        {kind === "file" ? (
          <input id={`${id}-source`} type="file" name="file" accept=".ics,text/calendar" aria-describedby={`${id}-source-hint`} />
        ) : (
          <input id={`${id}-source`} type="url" name="link" autoComplete="off" spellCheck={false} aria-describedby={`${id}-source-hint`} />
        )}
        <p id={`${id}-source-hint`} className={pageStyles.muted}>
          {sourceHint}
        </p>
      </div>
      <fieldset className={styles.dates} aria-describedby={`${id}-dates-hint`}>
        <legend>Dates</legend>
        <div className={styles.field}>
          <label htmlFor={`${id}-from`}>From</label>
          <input id={`${id}-from`} type="date" name="from" defaultValue={defaults.from ?? ""} />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-to`}>To</label>
          <input id={`${id}-to`} type="date" name="to" defaultValue={defaults.to ?? ""} />
        </div>
        <p id={`${id}-dates-hint`} className={pageStyles.muted}>
          {datesHint}
        </p>
      </fieldset>
      <button type="submit" disabled={pending}>
        {pending ? "Importing" : "Import"}
      </button>
    </form>
  );
}
