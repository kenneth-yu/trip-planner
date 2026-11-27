"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import pageStyles from "../../../ui/page.module.css";
import styles from "./past-people.module.css";

const VISIBLE = 5;

export function PastPeople({ people }: { people: { id: string; name: string }[] }) {
  const [all, setAll] = useState(false);
  const { pending } = useFormStatus();
  if (people.length === 0) return null;
  const shown = all ? people : people.slice(0, VISIBLE);
  return (
    <section className={styles.group}>
      <h3 className={pageStyles.sectionTitle}>People from your trips</h3>
      <ul className={styles.list}>
        {shown.map((p) => (
          <li key={p.id}>
            <button type="submit" name="personId" value={p.id} className={styles.person} disabled={pending} aria-label={`Create an invite link for ${p.name}`}>
              {p.name}
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
