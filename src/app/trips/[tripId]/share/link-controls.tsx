"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import pageStyles from "../../../ui/page.module.css";
import styles from "./share.module.css";
import {
  disableLinkAction,
  enableLinkAction,
  rotateLinkAction,
  setLinkDeadlinesAction,
  setViewerDeadlinesAction,
  type LinkRevealState,
  type SwitchState,
} from "./actions";

function subscribeNothing() {
  return () => undefined;
}

const noReveal: LinkRevealState = { url: null, error: null };
const noSwitch: SwitchState = { saved: false, error: null };

function SwitchRow({ name, label, checked, hint, tripId, action }: { name: string; label: string; checked: boolean; hint?: string; tripId: string; action: (form: FormData) => void }) {
  return (
    <form action={action}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="on" value={String(!checked)} />
      <label className={styles.option}>
        <input type="checkbox" role="switch" name={name} checked={checked} aria-checked={checked} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
        <span>
          {label} <span className={pageStyles.muted}>({checked ? "on" : "off"})</span>
          {hint && <span className={`${pageStyles.muted} ${styles.hint}`}>{hint}</span>}
        </span>
      </label>
    </form>
  );
}

function RevealedLink({ url }: { url: string }) {
  const canShare = useSyncExternalStore(subscribeNothing, () => typeof navigator.share === "function", () => false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function copy() {
    setProblem(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch (e) {
      setCopied(false);
      setProblem(e instanceof Error ? "Could not copy. Select the link and copy it." : "Could not copy.");
    }
  }
  async function share() {
    try {
      await navigator.share({ url });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) await copy();
    }
  }
  return (
    <div>
      <input className={styles.link} readOnly value={url} aria-label="Link for family and friends" onFocus={(e) => e.currentTarget.select()} />
      <div className={pageStyles.row}>
        <button type="button" onClick={copy}>
          Copy link
        </button>
        {canShare && (
          <button type="button" className="quiet" onClick={share}>
            Share
          </button>
        )}
      </div>
      <p role="status" className={pageStyles.muted}>
        {copied ? "Link copied." : ""}
      </p>
      {problem && (
        <p role="alert" className={pageStyles.warning}>
          {problem}
        </p>
      )}
      <p className={pageStyles.muted}>You will not see this link again. Make a new link if you lose it.</p>
    </div>
  );
}

export function LinkControls({ tripId, enabled, showsDeadlines }: { tripId: string; enabled: boolean; showsDeadlines: boolean }) {
  const [enabledState, enable] = useActionState(enableLinkAction, noReveal);
  const [rotatedState, rotate, rotating] = useActionState(rotateLinkAction, noReveal);
  const [, disable] = useActionState(disableLinkAction, noSwitch);
  const [deadlinesState, setDeadlines] = useActionState(setLinkDeadlinesAction, noSwitch);
  const [confirmingAt, setConfirmingAt] = useState<LinkRevealState | null>(null);
  const confirming = confirmingAt === rotatedState;
  const url = rotatedState.url ?? enabledState.url;
  const error = enabledState.error ?? rotatedState.error;

  return (
    <div>
      <form action={enabled ? disable : enable}>
        <input type="hidden" name="tripId" value={tripId} />
        <label className={styles.option}>
          <input type="checkbox" role="switch" checked={enabled} aria-checked={enabled} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
          <span>
            Anyone with the link can see this trip <span className={pageStyles.muted}>({enabled ? "on" : "off"})</span>
            <span className={`${pageStyles.muted} ${styles.hint}`}>They see times and places, never codes, seats or prices, and never anything you hid.</span>
          </span>
        </label>
      </form>
      {error && (
        <p role="alert" className={pageStyles.warning}>
          {error}
        </p>
      )}
      {enabled && (
        <>
          {url ? <RevealedLink url={url} /> : <p className={pageStyles.muted}>The link was shown when you made it. Make a new link to get one you can send.</p>}
          <SwitchRow name="showsDeadlines" label="Show deadlines on the link" checked={showsDeadlines} tripId={tripId} action={setDeadlines} />
          <p role="status" className={pageStyles.muted}>
            {deadlinesState.saved ? "Saved" : ""}
          </p>
          {deadlinesState.error && (
            <p role="alert" className={pageStyles.warning}>
              {deadlinesState.error}
            </p>
          )}
          {confirming ? (
            <form action={rotate} className={styles.inline}>
              <input type="hidden" name="tripId" value={tripId} />
              <span>Make a new link? The current one stops working right away.</span>
              <button disabled={rotating}>Make new link</button>
              <button type="button" className="quiet" autoFocus onClick={() => setConfirmingAt(null)}>
                Keep
              </button>
            </form>
          ) : (
            <button type="button" className="quiet" onClick={() => setConfirmingAt(rotatedState)}>
              Make a new link
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function ViewerDeadlines({ tripId, checked }: { tripId: string; checked: boolean }) {
  const [state, action] = useActionState(setViewerDeadlinesAction, noSwitch);
  return (
    <div>
      <SwitchRow name="viewersSeeDeadlines" label="Viewers see deadlines" checked={checked} tripId={tripId} action={action} />
      <p role="status" className={pageStyles.muted}>
        {state.saved ? "Saved" : ""}
      </p>
      {state.error && (
        <p role="alert" className={pageStyles.warning}>
          {state.error}
        </p>
      )}
    </div>
  );
}
