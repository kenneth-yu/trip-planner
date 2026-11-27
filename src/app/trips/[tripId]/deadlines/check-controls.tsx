"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "../../../ui/page.module.css";
import { dismissCheckAction, restoreCheckAction } from "./actions";

type Phase = "open" | "saving" | "done" | "undoing";

const FIRST_WORDS = 8;

export function startOf(sentence: string): string {
  return sentence.split(/\s+/).slice(0, FIRST_WORDS).join(" ").replace(/[.,:;]+$/, "");
}

export function CheckLine({ tripId, anchor, sentence, canEdit }: { tripId: string; anchor: string; sentence: string; canEdit: boolean }) {
  const [phase, setPhase] = useState<Phase>("open");
  const [failed, setFailed] = useState(false);
  const fine = useRef<HTMLButtonElement>(null);
  const undo = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  const statusId = useId();

  useEffect(() => {
    if (!moved.current) return;
    if (phase === "done") undo.current?.focus();
    if (phase === "open") fine.current?.focus();
  }, [phase]);

  async function change(action: typeof dismissCheckAction, during: Phase, after: Phase, before: Phase) {
    setFailed(false);
    setPhase(during);
    const result = await action({ tripId, anchor });
    moved.current = result.ok;
    setFailed(!result.ok);
    setPhase(result.ok ? after : before);
  }

  const marked = phase === "done" || phase === "undoing";
  return (
    <>
      <span role="status" id={statusId} className={styles.muted}>
        {marked ? "Marked as fine." : ""}
      </span>
      {marked ? (
        <>
          <div className={styles.muted}>{sentence}</div>
          <div className={styles.muted}>Hidden for everyone on this trip.</div>
          <button ref={undo} type="button" className={styles.textButton} aria-describedby={statusId} disabled={phase === "undoing"} onClick={() => change(restoreCheckAction, "undoing", "open", "done")}>
            Undo
          </button>
        </>
      ) : (
        <>
          <div>{sentence}</div>
          {canEdit && (
            <button
              ref={fine}
              type="button"
              className={styles.textButton}
              aria-label={`This is fine: ${startOf(sentence)}`}
              disabled={phase === "saving"}
              onClick={() => change(dismissCheckAction, "saving", "done", "open")}
            >
              {phase === "saving" ? "Saving" : "This is fine"}
            </button>
          )}
        </>
      )}
      {failed && (
        <p role="alert" className={styles.warning}>
          That did not save. Try again.
        </p>
      )}
    </>
  );
}

export function ShowAgain({ tripId, anchor }: { tripId: string; anchor: string }) {
  const [phase, setPhase] = useState<"idle" | "working" | "back">("idle");
  const [failed, setFailed] = useState(false);

  async function restore() {
    setFailed(false);
    setPhase("working");
    const result = await restoreCheckAction({ tripId, anchor });
    setFailed(!result.ok);
    setPhase(result.ok ? "back" : "idle");
  }

  return (
    <>
      <span role="status" className={styles.muted}>
        {phase === "back" ? "Showing again." : ""}
      </span>
      {phase !== "back" && (
        <button type="button" className={styles.textButton} disabled={phase === "working"} onClick={restore}>
          Show again
        </button>
      )}
      {failed && (
        <p role="alert" className={styles.warning}>
          That did not save. Try again.
        </p>
      )}
    </>
  );
}
