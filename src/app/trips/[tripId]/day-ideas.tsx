"use client";

import Link from "next/link";
import { useId, useState } from "react";
import styles from "./days.module.css";

export interface DayIdeaLine {
  city: string;
  line: string;
  ideas: { id: string; title: string; second: string | null }[];
}

function Line({ item, tripId }: { item: DayIdeaLine; tripId: string }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className={styles.ideas}>
      <button type="button" className={`quiet ${styles.ideasButton}`} aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
        {item.line}
      </button>
      {open && (
        <div id={panel}>
          <ul className={styles.ideasList}>
            {item.ideas.map((idea) => (
              <li key={idea.id}>
                {idea.title}
                {idea.second && <span className={styles.ideasSecond}>{idea.second}</span>}
              </li>
            ))}
          </ul>
          <p>
            <Link href={`/trips/${tripId}/ideas`}>All ideas</Link>
          </p>
        </div>
      )}
    </div>
  );
}

export function DayIdeas({ lines, tripId }: { lines: DayIdeaLine[]; tripId: string }) {
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((item) => (
        <Line key={item.city} item={item} tripId={tripId} />
      ))}
    </>
  );
}
