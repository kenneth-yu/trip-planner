"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import pageStyles from "../../../../ui/page.module.css";
import styles from "../../../../account/account.module.css";
import { deleteTripAction, type DeleteTripState } from "./actions";

const COPY = {
  mismatch: (name: string) => `That does not match. Type ${name}.`,
  google: "Google did not let us delete a calendar for this trip, so nothing was deleted. Try again in a few minutes.",
  failed: "That did not delete. Try again.",
} as const;

export function DeleteTripForm({ tripId, tripName }: { tripId: string; tripName: string }) {
  const [state, action, pending] = useActionState<DeleteTripState, FormData>(deleteTripAction, { status: "idle" });
  const [typed, setTyped] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.status === "mismatch") field.current?.focus();
  }, [state]);
  const message = state.status === "idle" ? null : state.status === "mismatch" ? COPY.mismatch(tripName) : COPY[state.status];
  return (
    <form action={action} className={styles.stack}>
      <input type="hidden" name="tripId" value={tripId} />
      <div>
        <label htmlFor="confirm">Type the trip name to confirm</label>
        <span id="confirm-hint" className={styles.hint}>
          {tripName}
        </span>
        <input
          id="confirm"
          ref={field}
          name="confirm"
          className={styles.field}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          readOnly={pending}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby="confirm-hint"
        />
      </div>
      {message && (
        <p role="alert" className={pageStyles.warning}>
          {message}
        </p>
      )}
      <button className={styles.danger} disabled={pending}>
        {pending ? "Deleting" : "Delete trip"}
      </button>
    </form>
  );
}
