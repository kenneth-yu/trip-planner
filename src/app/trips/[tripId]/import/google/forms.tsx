"use client";

import { useActionState } from "react";
import styles from "../../../../ui/page.module.css";
import { runGoogleImport, type ImportState } from "./actions";

export function ImportForm({ tripId, calendars, from, to }: { tripId: string; calendars: { id: string; summary: string }[]; from: string; to: string }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(runGoogleImport, { message: null, error: false });
  return (
    <form action={action}>
      <input type="hidden" name="tripId" value={tripId} />
      <fieldset>
        <legend>Calendars</legend>
        {calendars.map((c) => (
          <label key={c.id} className={styles.row}>
            <input type="checkbox" name="calendar" value={c.id} />
            {c.summary}
          </label>
        ))}
      </fieldset>
      <div className={styles.row}>
        <label>
          From
          <input type="date" name="from" defaultValue={from} required />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={to} required />
        </label>
      </div>
      <button disabled={pending}>Import</button>
      {state.message && <p role={state.error ? "alert" : "status"}>{state.message}</p>}
    </form>
  );
}
