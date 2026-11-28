"use client";

import { useActionState, useState } from "react";
import pageStyles from "../ui/page.module.css";
import styles from "./account.module.css";
import { saveTravelTipsAction, type TravelTipsState } from "./travel-tips-actions";
import { LISTED_TIP_KINDS, TIP_KIND_LABELS, type TipKind } from "@/domain/smarts/kinds";

export function TravelTipsSection({ tipsOn, kindsOff }: { tipsOn: boolean; kindsOff: TipKind[] }) {
  const [on, setOn] = useState(tipsOn);
  const [state, action, pending] = useActionState<TravelTipsState, FormData>(saveTravelTipsAction, { status: "idle" });
  return (
    <section id="travel-smarts" className={styles.section}>
      <h2 className={pageStyles.sectionTitle}>Travel smarts</h2>
      <p>Small suggestions under your flights and stays, like when to leave for the airport. They only show to people who can edit a trip.</p>
      <form action={action} className={styles.stack}>
        <label>
          <input type="checkbox" role="switch" name="tipsOn" checked={on} aria-checked={on} onChange={(e) => setOn(e.currentTarget.checked)} /> Travel tips
        </label>
        <span aria-hidden="true">{on ? "On" : "Off"}</span>
        <fieldset hidden={!on}>
          <legend>Kinds of tips</legend>
          {LISTED_TIP_KINDS.map((kind) => (
            <label key={kind} className={styles.hint}>
              <input type="checkbox" name="kind" value={kind} defaultChecked={!kindsOff.includes(kind)} /> {TIP_KIND_LABELS[kind]}
            </label>
          ))}
        </fieldset>
        <p className={styles.hint}>Warnings about real problems, like a tight connection or a time that looks wrong, always show. To hide one, choose This is fine on it.</p>
        <button type="submit" disabled={pending}>
          {pending ? "Saving" : "Save"}
        </button>
        <p role="status">{state.status === "saved" ? "Saved." : ""}</p>
        {state.status === "failed" && <p role="alert">That did not save. Try again.</p>}
      </form>
    </section>
  );
}
