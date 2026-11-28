"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import styles from "./item.module.css";
import type { DeleteState } from "./actions";

interface Props {
  tripId: string;
  itemId: string;
  heading: string;
  editHref: string;
  markBookedHref?: string;
  remove: (prev: DeleteState, form: FormData) => Promise<DeleteState>;
}

export function ItemActions({ tripId, itemId, heading, editHref, markBookedHref, remove }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(remove, { failed: false });
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);

  if (!confirming) {
    return (
      <div className={styles.actions}>
        {markBookedHref && (
          <Link href={markBookedHref} className={styles.edit}>
            Mark as booked
          </Link>
        )}
        <Link href={editHref} className={markBookedHref ? styles.quietEdit : styles.edit}>
          Edit
        </Link>
        <button type="button" className={styles.remove} onClick={() => setConfirming(true)}>
          Delete
        </button>
      </div>
    );
  }
  return (
    <form action={formAction} className={styles.actions}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="itemId" value={itemId} />
      <p role={state.failed ? "alert" : undefined} className={styles.confirm}>
        {state.failed ? "That did not delete. Try again." : `Delete ${heading}? This cannot be undone.`}
      </p>
      <button type="button" className={styles.keep} ref={keepRef} disabled={pending} onClick={() => setConfirming(false)}>
        Keep
      </button>
      <button type="submit" className={styles.remove} disabled={pending}>
        {pending ? "Deleting" : "Delete"}
      </button>
    </form>
  );
}
