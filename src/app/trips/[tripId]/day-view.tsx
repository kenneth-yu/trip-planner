import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./days.module.css";
import formStyles from "@/app/ui/item-form/item-form.module.css";
import { AddedMarker } from "@/app/ui/item-form/added-marker";
import { FlashStatus } from "@/app/ui/item-form/flash-status";

import type { Day, DayEntry } from "@/domain/time/days";
import type { FlightCard } from "@/domain/time/flight-card";
import type { TripView, VisibleItem } from "@/domain/visibility/project";
import { stayCities } from "@/domain/timeline/trip-grid";
import { groupFreeDays } from "@/domain/time/days";
import { rowKey } from "@/domain/smarts/rows";
import { SmartRow, TipsIntro, type SmartRows } from "./smart-row";
import { ideasForDay, type Idea } from "@/domain/ideas/ideas";
import { DayIdeas } from "./day-ideas";

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

function Row({ href, linked, className, children }: { href: string; linked: boolean; className: string; children: ReactNode }) {
  if (!linked) return <div className={className}>{children}</div>;
  return (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}

function Entry({ entry, view, colors, smart }: { entry: DayEntry; view: TripView; colors: Map<string, string>; smart: SmartRows | undefined }) {
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
  const href = `/trips/${view.trip.id}/items/${entry.itemId}`;
  const linked = view.permissions.role !== "link";
  if (entry.kind === "flight") {
    return (
      <li className={styles.entry}>
        <Row className={styles.flightRow} href={href} linked={linked}>
          <Flight card={entry.card} itemId={entry.itemId} item={item} />
        </Row>
        <SmartRow tripId={view.trip.id} canEdit={view.permissions.canEdit} row={smart?.rows.get(rowKey(entry.itemId, "flight"))} />
      </li>
    );
  }
  const isStay = entry.kind === "check_in" || entry.kind === "check_out";
  const city = isStay ? entry.place : null;
  const title = entry.kind === "event" ? entry.title : entry.text;
  const place = entry.place;
  return (
    <li className={styles.entry}>
      <Row className={isStay ? `${styles.row} ${styles.stay} ${(city && colors.get(city)) || ""}` : styles.row} href={href} linked={linked}>
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
      </Row>
      <SmartRow tripId={view.trip.id} canEdit={view.permissions.canEdit} row={smart?.rows.get(rowKey(entry.itemId, entry.kind))} />
    </li>
  );
}

export function DayView({ view, days, todayKey, only, anchors = true, smart, ideas = [] }: { view: TripView; days: Day[]; todayKey: string; only?: string; anchors?: boolean; smart?: SmartRows; ideas?: Idea[] }) {
  const colors = cityColors(view);
  if (!days.length) {
    return (
      <div className={styles.empty}>
        <FlashStatus kind="deleted" tripId={view.trip.id} />
        {view.permissions.canEdit ? (
          <>
            <p className={styles.emptyTitle}>Start with your flights.</p>
            <p>Booked or not, add the flights first. The app works out which nights you need a bed, in local time.</p>
            <p>
              <Link className={formStyles.primaryLink} href={`/trips/${view.trip.id}/add?type=flight`}>
                Add a flight
              </Link>
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
      <FlashStatus kind="deleted" tripId={view.trip.id} />
      <FlashStatus kind="fixed" tripId={view.trip.id} />
      <FlashStatus kind="fine" tripId={view.trip.id} />
      <FlashStatus kind="tip_hidden" tripId={view.trip.id} />
      {smart?.showIntro && <TipsIntro />}
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
                <Entry key={`${e.kind}-${"itemId" in e ? e.itemId : e.key}-${i}`} entry={e} view={view} colors={colors} smart={smart} />
              ))}
            </ul>
          )}
          <DayIdeas
            tripId={view.trip.id}
            lines={ideasForDay(day, ideas).map((found) => ({ city: found.city, line: found.line, ideas: found.ideas.map((idea) => ({ id: idea.id, title: idea.title, second: [idea.location?.name, idea.note.split("\n")[0]].filter(Boolean).join(" · ") || null })) }))}
          />
        </details>
      ))}
    </>
  );
}
