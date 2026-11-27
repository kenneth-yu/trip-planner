"use client";

import { useActionState } from "react";
import styles from "../../ui/item-form/item-form.module.css";
import { createTripAction, type NewTripState } from "./actions";

export function NewTripForm() {
  const [state, action, pending] = useActionState<NewTripState, FormData>(createTripAction, { error: null, name: "" });
  return (
    <form action={action} className={styles.tripName} noValidate>
      <div className={styles.field} data-invalid={state.error ? "true" : undefined}>
        <label htmlFor="trip-name">Trip name</label>
        <input id="trip-name" name="name" defaultValue={state.name} placeholder="Japan and Hong Kong" autoComplete="off" autoCapitalize="words" maxLength={120} aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "trip-name-error" : undefined} />
        {state.error && (
          <p className={styles.error} id="trip-name-error" role="alert">
            {state.error}
          </p>
        )}
      </div>
      <div className={styles.submitBar}>
        <button type="submit" disabled={pending}>
          Create trip
        </button>
      </div>
    </form>
  );
}
