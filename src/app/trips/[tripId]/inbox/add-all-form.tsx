"use client";

import { useTransition } from "react";
import styles from "../../../ui/page.module.css";
import { addAllClean } from "../actions";
import { useResults } from "./result";

export function AddAllForm({ tripId, entryIds }: { tripId: string; entryIds: string[] }) {
  const { show } = useResults();
  const [pending, start] = useTransition();
  function submit(form: FormData) {
    start(async () => {
      const { text } = await addAllClean(form);
      show(text ? { text, role: "status" } : null);
    });
  }
  return (
    <form action={submit} className={styles.row} style={{ marginBottom: 16 }}>
      <input type="hidden" name="tripId" value={tripId} />
      {entryIds.map((id) => (
        <input key={id} type="hidden" name="entryId" value={id} />
      ))}
      <button disabled={pending}>{pending ? "Adding" : `Add all without conflicts (${entryIds.length})`}</button>
    </form>
  );
}
