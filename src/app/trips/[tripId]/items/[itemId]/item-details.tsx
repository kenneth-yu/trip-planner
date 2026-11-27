import styles from "./item.module.css";
import { CopyButton } from "./copy-button";
import { buildFlightCard } from "@/domain/time/flight-card";
import { formatClock, formatDayHeader, homeReference, toLocal } from "@/domain/time/format";
import { buildDeadlineLines } from "@/domain/deadlines/deadlines";
import { itemCity } from "@/domain/time/days";
import type { ItemPrivate, ZonedTime } from "@/domain/types";
import type { TripView, VisibleItem } from "@/domain/visibility/project";

interface Moment {
  label: string | null;
  day: string;
  time: string;
  place: string | null;
  home: string | null;
  tag: string | null;
}

function moment(label: string | null, t: ZonedTime, view: TripView, place: string | null = null, tag: string | null = null): Moment {
  const local = toLocal(t);
  return { label, day: formatDayHeader(local), time: formatClock(local), place, home: homeReference(t, view.homeZone), tag };
}

function moments(item: VisibleItem, view: TripView): { rows: Moment[]; lead: string | null; sentence: string | null } {
  if (item.type === "flight" && item.flight) {
    const card = buildFlightCard(item, view.homeZone);
    return {
      lead: card.duration,
      sentence: card.clockSentence,
      rows: [
        { ...moment("Departs", item.start, view, card.depart.place), home: null },
        { ...moment("Arrives", item.end, view, card.arrive.place, card.arrive.tag), home: card.arrive.home },
      ],
    };
  }
  if (item.type === "stay") {
    return { lead: null, sentence: null, rows: [moment("Check in", item.start, view), moment("Check out", item.end, view)] };
  }
  return { lead: null, sentence: null, rows: [moment(null, item.start, view)] };
}

function firstName(view: TripView, id: string | null): string | null {
  if (!id) return null;
  return (view.travelers.find((t) => t.id === id)?.name ?? "Someone").split(" ")[0];
}

interface Entry {
  who: string | null;
  value: string;
}

function entriesFor(view: TripView, rows: ItemPrivate[], pick: (p: ItemPrivate) => string | undefined): Entry[] {
  const all = rows.flatMap((p) => {
    const value = pick(p);
    return value ? [{ who: firstName(view, p.travelerId), value }] : [];
  });
  const distinct = new Set(all.map((e) => e.value));
  if (distinct.size === 1) return [{ who: null, value: all[0].value }];
  return all;
}

function Field({ label, entries, big }: { label: string; entries: Entry[]; big?: boolean }) {
  if (!entries.length) return null;
  return (
    <section className={styles.field}>
      {entries.map((e, i) => (
        <div key={i} className={styles.fieldRow}>
          <div className={styles.fieldHead}>
            <span className={styles.label}>{e.who ? `${label}, ${e.who}` : label}</span>
            <CopyButton value={e.value} what={e.who ? `${label.toLowerCase()} for ${e.who}` : label.toLowerCase()} />
          </div>
          <div className={big ? (e.value.length > 10 ? `${styles.code} ${styles.codeLong}` : styles.code) : styles.value}>{e.value}</div>
        </div>
      ))}
    </section>
  );
}

export function ItemDetails({ view, item, nowMs }: { view: TripView; item: VisibleItem; nowMs: number }) {
  const { rows, lead, sentence } = moments(item, view);
  const city = itemCity(item);
  const placeName = item.type === "flight" ? null : [item.location?.name && item.location.name !== item.title ? item.location.name : null, city].filter(Boolean).join(", ") || null;
  const address = item.location?.address ?? null;
  const sensitive = view.permissions.canSeeSensitive;
  const priv = sensitive ? item.private : [];
  const seats = entriesFor(view, priv, (p) => p.seat);
  const seatLine = priv.flatMap((p) => (p.seat ? [[firstName(view, p.travelerId), p.seat] as const] : [])).map(([who, seat]) => (who ? `${who} ${seat}` : seat)).join(", ");
  const prices = entriesFor(view, priv, (p) => (p.price ? `${p.price.currency} ${p.price.amount}` : undefined));
  const notes = [...priv.flatMap((p) => (p.notes ? [p.notes] : [])), ...(sensitive && item.notes ? [item.notes] : [])];
  const deadlines = buildDeadlineLines(view, nowMs).filter((l) => l.itemId === item.id);
  return (
    <article className={styles.item}>
      <h2 className={styles.title}>{item.title}</h2>
      <div className={styles.when}>
        {rows.map((r, i) => (
          <div key={i} className={styles.moment}>
            <div className={styles.momentHead}>
              {r.label && <span className={styles.label}>{r.label}</span>}
              <span className={styles.day}>{r.day}</span>
            </div>
            <div className={styles.time}>
              {r.time}
              {r.tag && <span className={styles.tag}>{r.tag}</span>}
            </div>
            {(r.place || r.home) && (
              <div className={styles.sub}>
                {r.place}
                {r.place && r.home && " · "}
                {r.home}
              </div>
            )}
          </div>
        ))}
        {lead && <div className={styles.sub}>{lead}</div>}
        {sentence && <div className={styles.sub}>{sentence}</div>}
        {(item.startIsEstimated || item.endIsEstimated) && <div className={styles.sub}>Times are estimated. Check the booking.</div>}
      </div>
      {(placeName || address) && (
        <div className={styles.place}>
          {placeName && <div>{placeName}</div>}
          {address && <div className={styles.sub}>{address}</div>}
        </div>
      )}
      {item.flags.map((f) => (
        <p key={f} className={styles.check}>
          {f}
        </p>
      ))}
      {sensitive && (
        <>
          <Field label="Confirmation code" entries={entriesFor(view, priv, (p) => p.confirmationCode)} big />
          <Field label="Booking reference" entries={entriesFor(view, priv, (p) => p.bookingReference)} />
          {seats.length > 0 && (
            <section className={styles.field}>
              <div className={styles.fieldHead}>
                <span className={styles.label}>Seats</span>
                <CopyButton value={seatLine} what="seats" />
              </div>
              <div className={styles.value}>{seatLine}</div>
            </section>
          )}
          <Field label="Phone" entries={entriesFor(view, priv, (p) => p.phone)} />
          <Field label="Price" entries={prices} />
          {notes.map((n, i) => (
            <section key={i} className={styles.field}>
              <div className={styles.fieldHead}>
                <span className={styles.label}>Notes</span>
                <CopyButton value={n} what="notes" />
              </div>
              <div className={styles.notes}>{n}</div>
            </section>
          ))}
        </>
      )}
      {deadlines.length > 0 && (
        <section className={styles.field}>
          {deadlines.map((l) => (
            <div key={l.id} className={styles.deadline}>
              <div className={l.warning ? styles.check : undefined}>{l.sentence}</div>
              <div className={styles.sub}>{l.exact}</div>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
