"use client";

import { useActionState, useEffect, useRef } from "react";
import styles from "../../../../ui/page.module.css";
import local from "./google-import.module.css";
import { runGoogleImport, type ImportState } from "./actions";

export function ImportForm({ tripId, calendars, from, to }: { tripId: string; calendars: { id: string; summary: string }[]; from: string; to: string }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(runGoogleImport, { message: null, error: false });
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!pending && state.error) alert.current?.focus();
  }, [pending, state]);
  return (
    <form action={action}>
      <input type="hidden" name="tripId" value={tripId} />
      <fieldset className={local.group}>
        <legend>Calendars</legend>
        {calendars.map((c) => (
          <label key={c.id} className={local.calendar}>
            <input type="checkbox" name="calendar" value={c.id} />
            {c.summary}
          </label>
        ))}
      </fieldset>
      <fieldset className={local.group}>
        <legend>Dates</legend>
        <p className={`${styles.muted} ${local.hint}`} id="import-dates-hint">
          Only events between these dates come in.
        </p>
        <label className={local.field}>
          From
          <input type="date" name="from" defaultValue={from} required aria-describedby="import-dates-hint" />
        </label>
        <label className={local.field}>
          To
          <input type="date" name="to" defaultValue={to} required aria-describedby="import-dates-hint" />
        </label>
      </fieldset>
      <button disabled={pending}>{pending ? "Importing" : "Import"}</button>
      <p role="status" className={styles.resultLine}>
        {pending ? "Reading your calendars." : state.error ? "" : (state.message ?? "")}
      </p>
      <p ref={alert} role="alert" tabIndex={-1} className={`${styles.resultLine} ${styles.warning}`}>
        {!pending && state.error ? state.message : ""}
      </p>
    </form>
  );
}
