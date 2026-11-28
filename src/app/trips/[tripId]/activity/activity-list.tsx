"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import pageStyles from "../../../ui/page.module.css";
import styles from "./activity.module.css";
import { undoAction } from "./actions";
import { noUndo } from "./undo-state";
import type { Group } from "./describe";

export function ActivityList({ tripId, groups, olderHref }: { tripId: string; groups: Group[]; olderHref: string | null }) {
  const [state, action, pending] = useActionState(undoAction, noUndo);
  const status = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.parts.length > 0) status.current?.focus();
  }, [state]);
  return (
    <div>
      <p ref={status} tabIndex={-1} role="status" className={styles.status}>
        {state.parts.map((part, i) =>
          part.href ? (
            <Link key={i} href={part.href}>
              {part.text}
            </Link>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
      {groups.map((group) => (
        <section key={group.heading} className={pageStyles.section}>
          <h2 className={pageStyles.sectionTitle}>{group.heading}</h2>
          <ul className={pageStyles.list}>
            {group.rows.map((row) => (
              <li key={row.id} className={styles.row}>
                <div>
                  <div>
                    {row.sentence.lead}
                    {row.sentence.title && (row.itemId ? <Link href={`/trips/${tripId}/items/${row.itemId}`}>{row.sentence.title}</Link> : row.sentence.title)}
                    {row.sentence.tail}
                  </div>
                  <div className={pageStyles.muted}>{row.detail}</div>
                </div>
                {row.canUndo && (
                  <form action={action}>
                    <input type="hidden" name="tripId" value={tripId} />
                    <input type="hidden" name="activityId" value={row.id} />
                    <button className="quiet" aria-label={row.undoName} disabled={pending}>
                      {pending ? "Undoing" : "Undo"}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {olderHref && (
        <p>
          <Link className="quiet" href={olderHref}>
            Show older
          </Link>
        </p>
      )}
    </div>
  );
}
