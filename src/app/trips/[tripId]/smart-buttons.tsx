"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./smart-line.module.css";
import { dismissCheckAction } from "./deadlines/actions";
import { acknowledgeIntroAction, applyFixAction, hideTipKindAction, type SmartResult } from "./smart-actions";
import type { TipKind } from "@/domain/smarts/kinds";

type Run = () => Promise<SmartResult>;

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(act: Run, done: string) {
    setBusy(true);
    setMessage("");
    const result = await act();
    setBusy(false);
    setMessage(result.ok ? done : "That did not save. Try again.");
    if (result.ok) router.refresh();
  }
  return { busy, message, run };
}

export function CheckButtons({ tripId, anchor, fix }: { tripId: string; anchor: string; fix?: { label: string; done: string } }) {
  const { busy, message, run } = useAction();
  return (
    <div className={styles.actions}>
      {fix && (
        <button type="button" className={styles.action} disabled={busy} onClick={() => run(() => applyFixAction({ tripId, anchor }), fix.done)}>
          {fix.label}
        </button>
      )}
      <button type="button" className={styles.action} disabled={busy} onClick={() => run(() => dismissCheckAction({ tripId, anchor }), "Marked as fine.")}>
        This is fine
      </button>
      <span role="status" className={styles.status}>
        {message}
      </span>
    </div>
  );
}

export function TipButtons({ tripId, kind }: { tripId: string; kind: TipKind }) {
  const { busy, message, run } = useAction();
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.action} disabled={busy} onClick={() => run(() => hideTipKindAction({ tripId, kind }), "Hidden. You can turn these back on in your account.")}>
        Hide tips like this
      </button>
      <span role="status" className={styles.status}>
        {message}
      </span>
    </div>
  );
}

export function TipsIntro({ tripId }: { tripId: string }) {
  const { busy, message, run } = useAction();
  return (
    <div className={styles.intro}>
      <p>Travel tips are small suggestions about your flights and stays. They are not warnings. You can turn them off, or just some kinds, in your account.</p>
      <button type="button" className={styles.action} disabled={busy} onClick={() => run(() => acknowledgeIntroAction({ tripId }), "")}>
        Got it
      </button>
      <span role="status" className={styles.status}>
        {message}
      </span>
    </div>
  );
}
