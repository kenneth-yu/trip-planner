import Link from "next/link";
import styles from "./days.module.css";
import formStyles from "@/app/ui/item-form/item-form.module.css";
import { AddedMarker } from "@/app/ui/item-form/added-marker";

import type { Day, DayEntry } from "@/domain/time/days";
import type { FlightCard } from "@/domain/time/flight-card";
import type { TripView, VisibleItem } from "@/domain/visibility/project";
import { stayCities } from "@/domain/timeline/trip-grid";
import { groupFreeDays } from "@/domain/time/days";

const CITY_CLASSES = [styles.city1, styles.city2, styles.city3, styles.city4, styles.city5];

export function cityColors(view: TripView): Map<string, string> {
  return new Map(stayCities(view).map((city, i) => [city, CITY_CLASSES[i % CITY_CLASSES.length]]));
}

function SharedCue({ item }: { item: VisibleItem | undefined }) {
  if (!item || item.visibility === "everyone") return null;
  return <span className={formStyles.cue}>{item.visibility === "only_me" ? "Only you" : "Not shared with everyone"}</span>;
}

function Flight({ card, itemId, item }: { card: FlightCard; itemId: string; item: VisibleItem | undefined }) {
  return (
    <div className={styles.flight}>
      <div className={styles.flightHead}>
        {card.header}
        <AddedMarker itemId={itemId} />
        <SharedCue item={item} />
      </div>
      <div className={styles.legs}>
        <div>
          <div className={styles.key}>{card.depart.time}</div>
          <div className={styles.legPlace}>{card.depart.place}</div>
        </div>
        <div className={styles.duration}>{card.duration}</div>
        <div className={styles.arrive}>
          <div className={styles.key}>
            <span className={styles.arrivalTime}>{card.arrive.time}</span>
            {card.arrive.tag && <span className={styles.tag}>{card.arrive.tag}</span>}
          </div>
          <div className={styles.legPlace}>
            {card.arrive.place}
            {card.arrive.home && <> · {card.arrive.home}</>}
          </div>
        </div>
      </div>
      {card.clockSentence && <div className={styles.clock}>{card.clockSentence}</div>}
    </div>
  );
}

function Details({ item, canSeeSensitive, names }: { item: VisibleItem; canSeeSensitive: boolean; names: Map<string, string> }) {
  const rows: [string, string][] = [];
  if (item.location?.address) rows.push(["Address", item.location.address]);
  if (item.travelerIds.length) rows.push(["Travelers", item.travelerIds.map((id) => names.get(id) ?? "Someone").join(", ")]);
  if (canSeeSensitive) {
    for (const p of item.private) {
      const who = p.travelerId ? `${names.get(p.travelerId)}: ` : "";
      if (p.confirmationCode) rows.push(["Confirmation", `${who}${p.confirmationCode}`]);
      if (p.bookingReference) rows.push(["Booking", `${who}${p.bookingReference}`]);
      if (p.seat) rows.push(["Seat", `${who}${p.seat}`]);
      if (p.phone) rows.push(["Phone", `${who}${p.phone}`]);
      if (p.price) rows.push(["Price", `${who}${p.price.currency} ${p.price.amount}`]);
      if (p.notes) rows.push(["From the booking", p.notes]);
    }
  }
  if (item.startIsEstimated || item.endIsEstimated) rows.push(["Times", "Estimated. Check the booking."]);
  if (item.status === "needs_review") rows.push(["Status", "Needs review"]);
  for (const flag of item.flags) rows.push(["Check", flag]);
  if (item.notes) rows.push(["Notes", item.notes]);
  if (!rows.length) return null;
  return (
    <div className={styles.detail}>
      <dl>
        {rows.map(([k, v], i) => (
          <div key={i} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd className={k === "Check" ? styles.check : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Entry({ entry, view, colors, names }: { entry: DayEntry; view: TripView; colors: Map<string, string>; names: Map<string, string> }) {
  if (entry.kind === "arrival") {
    return <li className={styles.arrival}>{entry.time}  {entry.text}</li>;
  }
  if (entry.kind === "in_air") {
    return <li className={styles.arrival}>{entry.text}</li>;
  }
  if (entry.kind === "busy") {
    return (
      <li className={styles.entry}>
        <div className={styles.static}>
          <span className={styles.time}>{entry.time}</span>
          <span>Busy</span>
        </div>
      </li>
    );
  }
  const item = view.items.find((i) => i.id === entry.itemId);
  const detail = item ? <Details item={item} canSeeSensitive={view.permissions.canSeeSensitive} names={names} /> : null;
  if (entry.kind === "flight") {
    return (
      <li className={styles.entry}>
        <details>
          <summary style={{ display: "block", padding: 0 }}>
            <Flight card={entry.card} itemId={entry.itemId} item={item} />
          </summary>
          {detail}
        </details>
      </li>
    );
  }
  const isStay = entry.kind === "check_in" || entry.kind === "check_out";
  const city = isStay ? entry.place : null;
  const title = entry.kind === "event" ? entry.title : entry.text;
  const place = entry.place;
  return (
    <li className={styles.entry}>
      <details>
        <summary className={isStay ? `${styles.stay} ${(city && colors.get(city)) || ""}` : undefined}>
          <span className={styles.time}>
            {entry.time}
            {entry.home && <span className={styles.home}>{entry.home}</span>}
          </span>
          <span>
            {title}
            {entry.kind !== "check_out" && <AddedMarker itemId={entry.itemId} />}
            {entry.kind !== "check_out" && <SharedCue item={item} />}
            {place && entry.kind === "event" && <span className={styles.sub}>{place}</span>}
            {item && item.flags.length > 0 && <span className={styles.flagged}>Check where this is</span>}
          </span>
        </summary>
        {detail}
      </details>
    </li>
  );
}

export function DayView({ view, days, todayKey, only, anchors = true }: { view: TripView; days: Day[]; todayKey: string; only?: string; anchors?: boolean }) {
  const colors = cityColors(view);
  const names = new Map(view.travelers.map((t) => [t.id, t.name]));
  if (!days.length) {
    return (
      <div className={styles.empty}>
        {view.permissions.canEdit ? (
          <>
            <p className={styles.emptyTitle}>Add your first flight or stay.</p>
            <p>
              <Link className={formStyles.primaryLink} href={`/trips/${view.trip.id}/add`}>
                Add flight or stay
              </Link>
            </p>
            <p className={styles.free}>
              <Link href={`/trips/${view.trip.id}/connect`}>Connect Claude or ChatGPT</Link>
            </p>
          </>
        ) : (
          <p className={styles.emptyTitle}>Nothing here yet.</p>
        )}
      </div>
    );
  }
  return (
    <>
      {groupFreeDays(days).filter((day) => !only || day.keys.includes(only)).map((day) => (
        <details key={day.key} id={anchors ? `day-${day.key}` : undefined} className={styles.day} open={Boolean(only) || day.keys[day.keys.length - 1] >= todayKey}>
          <summary>
            <span className={styles.date}>{day.header}</span>
            {day.place && <span className={styles.place}>{day.place}</span>}
          </summary>
          {anchors && day.keys.slice(1).map((k) => <span key={k} id={`day-${k}`} />)}
          {day.isFree ? (
            <p className={styles.free}>{day.keys.length > 1 ? "Free days" : "Free day"}</p>
          ) : (
            <ul className={styles.entries}>
              {day.entries.map((e, i) => (
                <Entry key={`${e.kind}-${"itemId" in e ? e.itemId : e.key}-${i}`} entry={e} view={view} colors={colors} names={names} />
              ))}
            </ul>
          )}
        </details>
      ))}
    </>
  );
}
