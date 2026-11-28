"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./smart-line.module.css";
import { applyFixAction, hideTipKindAction, markFineAction, type SmartResult } from "./smart-actions";
import type { TipKind } from "@/domain/smarts/kinds";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function run(act: () => Promise<SmartResult>) {
    setBusy(true);
    setFailed(false);
    const result = await act();
    setBusy(false);
    setFailed(!result.ok);
    if (result.ok) router.refresh();
  }
  return { busy, failed, run };
}

function Failed({ failed }: { failed: boolean }) {
  return <span role="alert">{failed ? "That did not save. Try again." : ""}</span>;
}

export function CheckButtons({ tripId, anchor, fix }: { tripId: string; anchor: string; fix?: { label: string; done: string } }) {
  const { busy, failed, run } = useAction();
  return (
    <div className={styles.actions}>
      {fix && (
        <button type="button" className={styles.action} disabled={busy} onClick={() => run(() => applyFixAction({ tripId, anchor }))}>
          {fix.label}
        </button>
      )}
      <button type="button" className={styles.action} disabled={busy} onClick={() => run(() => markFineAction({ tripId, anchor }))}>
        This is fine
      </button>
      <Failed failed={failed} />
    </div>
  );
}

export function TipButtons({ tripId, kind }: { tripId: string; kind: TipKind }) {
  const { busy, failed, run } = useAction();
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.action} disabled={busy} onClick={() => run(() => hideTipKindAction({ tripId, kind }))}>
        Hide tips like this
      </button>
      <Failed failed={failed} />
    </div>
  );
}
