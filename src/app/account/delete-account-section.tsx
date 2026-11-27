"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import pageStyles from "../ui/page.module.css";
import styles from "./account.module.css";
import { deleteAccountAction, type DeleteAccountState } from "./actions";

type Blocking = { tripId: string; name: string }[];

const MESSAGES = {
  mismatch: "Type delete to confirm.",
  google: "Google did not let us delete one of your calendars, so nothing was deleted. Try again in a few minutes.",
  failed: "That did not delete. Try again.",
} as const;

function BlockedList({ trips, raced }: { trips: Blocking; raced: boolean }) {
  return (
    <>
      {raced && <p role="alert">Someone joined one of your trips, so your account was not deleted.</p>}
      <p>You own trips that other people are on. Delete each one, or remove the other people from it, before you delete your account.</p>
      <ul className={pageStyles.list}>
        {trips.map((trip) => (
          <li key={trip.tripId}>
            {trip.name}
            <div className={styles.tripLinks}>
              <Link href={`/trips/${trip.tripId}/share`}>People on this trip</Link>
              <Link href={`/trips/${trip.tripId}/settings/delete`}>Delete trip</Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function DeleteAccountSection({ blocking, hasSharedSpecificItems }: { blocking: Blocking; hasSharedSpecificItems: boolean }) {
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(deleteAccountAction, { status: "idle", blockedBy: [] });
  const [typed, setTyped] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.status === "mismatch") field.current?.focus();
  }, [state]);

  const blockedNow = state.status === "blocked" ? state.blockedBy : blocking;
  const message = state.status === "mismatch" || state.status === "google" || state.status === "failed" ? MESSAGES[state.status] : null;

  return (
    <section className={styles.section}>
      <h2 className={pageStyles.sectionTitle}>Delete your account</h2>
      {blockedNow.length > 0 ? (
        <BlockedList trips={blockedNow} raced={state.status === "blocked"} />
      ) : (
        <form action={action} className={styles.stack}>
          <p>
            This deletes your account, the trips only you are on, and the Google calendars this app made for you. Trips you share with others stay, and what you added to them stays
            for the trip owner. Things only you could see are deleted.
          </p>
          {hasSharedSpecificItems && (
            <fieldset className={styles.group}>
              <legend>Things you shared with only some people</legend>
              <label className={styles.option}>
                <input type="radio" name="shared" value="give" defaultChecked />
                <span>Give each one to the first person you shared it with</span>
              </label>
              <label className={styles.option}>
                <input type="radio" name="shared" value="delete" />
                <span>Delete them</span>
              </label>
            </fieldset>
          )}
          <div>
            <label htmlFor="delete-confirm">Type delete to confirm</label>
            <input
              id="delete-confirm"
              ref={field}
              name="confirm"
              className={styles.field}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              readOnly={pending}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
          {message && (
            <p role="alert" className={pageStyles.warning}>
              {message}
            </p>
          )}
          <button className={styles.danger} disabled={pending}>
            {pending ? "Deleting" : "Delete account"}
          </button>
        </form>
      )}
    </section>
  );
}
