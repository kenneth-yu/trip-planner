"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import pageStyles from "../../../ui/page.module.css";
import styles from "../share/share.module.css";
import { calendarLinkAction } from "./calendar-link-actions";
import { noCalendarLink, subscribeUrl, type CalendarLinkState } from "./calendar-link-text";

export interface CalendarLinkStatus {
  madeOn: string;
  lastRead: string;
}

const subscribeNothing = () => () => undefined;

function ShownOnce({ url }: { url: string }) {
  const heading = useRef<HTMLParagraphElement>(null);
  const opensInCalendar = useSyncExternalStore(subscribeNothing, () => /iPhone|iPad|Macintosh|Android|Mobile/i.test(navigator.userAgent), () => false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => heading.current?.focus(), []);
  async function copy() {
    setProblem(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch (e) {
      setCopied(false);
      if (!(e instanceof Error)) throw e;
      setProblem("Could not copy. Select the link and copy it.");
    }
  }
  return (
    <div>
      <p ref={heading} tabIndex={-1}>
        <strong>Here is your calendar link.</strong>
      </p>
      <label className={styles.hint}>
        Calendar link
        <input className={styles.link} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div className={pageStyles.row}>
        <button type="button" onClick={copy}>
          Copy link
        </button>
        {opensInCalendar && (
          <a className="quiet" href={subscribeUrl(url)}>
            Open in Calendar
          </a>
        )}
      </div>
      <p role="status" className={pageStyles.muted}>
        {copied ? "Copied" : ""}
      </p>
      {problem && (
        <p role="alert" className={pageStyles.warning}>
          {problem}
        </p>
      )}
      <p>This link is yours. Anyone who has it sees the trip as you do, without codes, seats or prices. Do not share it; send people a trip invite instead.</p>
      <p className={pageStyles.muted}>You will not see this link again. Make a new one if you lose it.</p>
    </div>
  );
}

export function CalendarLink({ tripId, status }: { tripId: string; status: CalendarLinkStatus | null }) {
  const [state, action, pending] = useActionState<CalendarLinkState, FormData>(calendarLinkAction, noCalendarLink);
  const [confirming, setConfirming] = useState<"rotate" | "off" | null>(null);
  const hidden = (intent: string) => (
    <>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="intent" value={intent} />
    </>
  );
  const error = state.error ? (
    <p role="alert" className={pageStyles.warning}>
      {state.error}
    </p>
  ) : null;

  if (state.url) return <ShownOnce url={state.url} />;

  if (!status) {
    return (
      <div>
        <p className={pageStyles.muted}>See this trip in Apple Calendar, Outlook or any calendar app that subscribes to links. It updates on its own, usually within a few hours.</p>
        <p className={pageStyles.muted}>Codes, seats and prices are never in it. If you already mirror the trip to Google Calendar, you do not need this too.</p>
        <form action={action}>
          {hidden("make")}
          <button className="quiet" disabled={pending}>
            {pending ? "Making link" : "Make a calendar link"}
          </button>
        </form>
        <p role="status" className={pageStyles.muted}>
          {state.turnedOff ? "Calendar link turned off." : ""}
        </p>
        {error}
      </div>
    );
  }

  return (
    <div>
      <p>Calendar link made {status.madeOn}.</p>
      <p className={pageStyles.muted}>{status.lastRead}</p>
      {confirming === "rotate" && (
        <form action={action} className={styles.inline}>
          {hidden("rotate")}
          <span>Make a new link? Calendars using the current one stop updating.</span>
          <button type="button" autoFocus onClick={() => setConfirming(null)}>
            Keep
          </button>
          <button className={`quiet ${styles.danger}`} disabled={pending}>
            Make new link
          </button>
        </form>
      )}
      {confirming === "off" && (
        <form action={action} className={styles.inline}>
          {hidden("off")}
          <span>Turn off the calendar link? Calendars using it stop updating, and the trip stays in them as it was.</span>
          <button type="button" autoFocus onClick={() => setConfirming(null)}>
            Keep
          </button>
          <button className={`quiet ${styles.danger}`} disabled={pending}>
            Turn off
          </button>
        </form>
      )}
      {confirming === null && (
        <div className={pageStyles.row}>
          <button type="button" className="quiet" onClick={() => setConfirming("rotate")}>
            Make a new link
          </button>
          <button type="button" className={`quiet ${styles.danger}`} onClick={() => setConfirming("off")}>
            Turn off
          </button>
        </div>
      )}
      {error}
    </div>
  );
}
