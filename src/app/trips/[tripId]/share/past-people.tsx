"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import pageStyles from "../../../ui/page.module.css";
import styles from "./past-people.module.css";

const VISIBLE = 5;

export function PastPeople({ people }: { people: { id: string; name: string }[] }) {
  const [all, setAll] = useState(false);
  const { pending } = useFormStatus();
  const firstMore = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (all) firstMore.current?.focus();
  }, [all]);
  if (people.length === 0) return null;
  const shown = all ? people : people.slice(0, VISIBLE);
  return (
    <section className={styles.group}>
      <h3 className={pageStyles.sectionTitle}>People from your trips</h3>
      <ul className={styles.list}>
        {shown.map((p, i) => (
          <li key={p.id}>
            <button ref={i === VISIBLE ? firstMore : undefined} type="submit" name="personId" value={p.id} className={styles.person} disabled={pending} aria-label={`Create an invite link for ${p.name}`}>
              <span>{p.name}</span>
              <span className={styles.cue} aria-hidden="true">
                Invite
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!all && people.length > VISIBLE && (
        <button type="button" className="quiet" onClick={() => setAll(true)}>
          Show all {people.length}
        </button>
      )}
    </section>
  );
}
