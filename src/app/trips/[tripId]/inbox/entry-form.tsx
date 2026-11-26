"use client";

import { useActionState } from "react";
import styles from "../../../ui/page.module.css";
import { decideEntry, type ActionState } from "../actions";
import type { InboxEntry } from "@/server/services/inbox-service";

export function EntryForm({ tripId, entry }: { tripId: string; entry: InboxEntry }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(decideEntry, { message: null, error: false });
  return (
    <form action={action}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="entryId" value={entry.id} />
      {entry.differences.map((d) => (
        <fieldset key={d.field} style={{ border: 0, padding: 0, margin: "8px 0" }}>
          <legend className={styles.muted}>The records disagree on {d.field === "start" ? "departure" : d.field}</legend>
          {d.values.map((v, i) => (
            <label key={i} style={{ marginRight: 16 }}>
              <input type="radio" name={`choice:${d.field}`} value={i} required /> {v}
            </label>
          ))}
        </fieldset>
      ))}
      {entry.match?.differences.map((d) => (
        <fieldset key={d.field} style={{ border: 0, padding: 0, margin: "8px 0" }}>
          <legend className={styles.muted}>If merged, keep which {d.field === "start" ? "departure" : d.field}</legend>
          <label style={{ marginRight: 16 }}>
            <input type="radio" name={`keep:${d.field}`} value={0} /> {d.values[0]} now
          </label>
          <label>
            <input type="radio" name={`keep:${d.field}`} value={1} /> {d.values[1]} imported
          </label>
        </fieldset>
      ))}
      <div className={styles.row}>
        <button name="action" value="add" disabled={pending}>Add</button>
        {entry.match && (
          <button name="action" value="merge" className="quiet" disabled={pending}>
            Merge into {entry.match.title}
          </button>
        )}
        <button name="action" value="discard" className="quiet" disabled={pending} formNoValidate>
          Discard
        </button>
      </div>
      {state.message && <p className={state.error ? styles.warning : styles.muted}>{state.message}</p>}
    </form>
  );
}
