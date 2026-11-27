import styles from "../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import { listInbox } from "@/server/services/inbox-service";
import { formatClock, formatDayHeader, toLocal } from "@/domain/time/format";
import { buildFlightCard } from "@/domain/time/flight-card";
import { AddAllForm } from "./add-all-form";
import { EntryForm } from "./entry-form";
import { InboxResults } from "./result";

const SOURCE: Record<string, string> = {
  google_calendar: "Google Calendar",
  ics: "Calendar file",
  email: "Email",
  manual: "Added by hand",
  assistant: "AI assistant",
};

export default async function InboxPage({ params }: PageProps<"/trips/[tripId]/inbox">) {
  const { tripId } = await params;
  const { ctx, requester, view } = await loadTripPage(tripId);
  if (!view.permissions.canEdit) return <p className={styles.muted}>Only editors review imports.</p>;
  const entries = await listInbox(ctx, tripId, requester);
  const clean = entries.filter((e) => e.clean).length;
  return (
    <div className={styles.narrow}>
      <InboxResults>
        {clean > 0 && <AddAllForm tripId={tripId} clean={clean} />}
        {!entries.length && <p className={styles.muted}>Nothing waiting. Items from calendars and assistants show up here first.</p>}
      <ul className={styles.list}>
        {entries.map((e) => {
          const p = e.proposed;
          const start = toLocal(p.start);
          const card = p.type === "flight" && p.flight?.fromAirport && p.flight.toAirport ? buildFlightCard({ id: e.id, ...p }, requester.homeZone) : null;
          return (
            <li key={e.id}>
              <div>
                <strong>{p.title}</strong> <span className={styles.muted}>{p.type}</span>
              </div>
              <div className={styles.muted}>
                {card
                  ? `${formatDayHeader(start)}, ${card.depart.time} ${card.depart.place} to ${card.arrive.time} ${card.arrive.place}`
                  : `${formatDayHeader(start)}, ${p.startIsEstimated ? "from " : ""}${formatClock(start)}`}
              </div>
              <div className={styles.muted}>From {e.label || SOURCE[e.source]}</div>
              {e.match && (
                <div className={styles.muted}>
                  {e.match.strength === "strong" ? "Looks like" : "Might be"} {e.match.title}, already on the trip.
                </div>
              )}
              {p.problems.map((problem) => (
                <div key={problem} className={styles.warning}>
                  {problem}
                </div>
              ))}
              {e.unparsed.map((u) => (
                <div key={u} className={styles.muted}>
                  Could not read: “{u}”
                </div>
              ))}
              {e.namesRemovedTraveler && <div className={styles.warning}>Someone on this was removed from the trip. Adding it leaves them off.</div>}
              <EntryForm tripId={tripId} entry={e} />
            </li>
          );
        })}
      </ul>
      </InboxResults>
    </div>
  );
}
