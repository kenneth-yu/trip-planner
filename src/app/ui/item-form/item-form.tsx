"use client";

import Link from "next/link";
import { useActionState, useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import styles from "./item-form.module.css";
import { emptyFormState, type FormState, type HintKind, type PlaceHint } from "./form-state";
import { airlineFor } from "@/domain/import/airlines";
import { arrivalAfter } from "@/domain/import/arrival";
import type { ItemType, Visibility } from "@/domain/types";

export type { FormState } from "./form-state";

export interface ItemFormValues {
  type: ItemType;
  fields: Record<string, string>;
  seats: { traveler: string; seat: string }[];
  visibility: Visibility;
  visibleToUserIds: string[];
  showAsBusy: boolean;
}

export interface ItemFormProps {
  tripId: string;
  travelers: { id: string; name: string }[];
  members: { userId: string; name: string }[];
  initial?: ItemFormValues;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  hint: (request: { tripId: string; kind: HintKind; text: string; date?: string }) => Promise<PlaceHint>;
  submitLabel?: string;
  canChangeSharing: boolean;
  backHref: string;
}

const TYPES: { type: ItemType; label: string }[] = [
  { type: "flight", label: "Flight" },
  { type: "stay", label: "Stay" },
  { type: "plan", label: "Plan" },
  { type: "transfer", label: "Transfer" },
];

const LAST_TYPE_KEY = "trip-planner:last-add-type";
const DETAIL_FIELDS = ["confirmationCode", "phone", "price", "notes", "deadlineDate", "deadlineTime", "person"];
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_SHAPE = /^\d{2}:\d{2}$/;

function isItemType(value: string | undefined): value is ItemType {
  return TYPES.some((t) => t.type === value);
}

function liveFrom(initial: ItemFormValues | undefined, entries: FormState["values"]): Record<string, string> {
  const live: Record<string, string> = {};
  if (initial) {
    live.type = initial.type;
    live.visibility = initial.visibility;
    Object.assign(live, initial.fields);
    for (const s of initial.seats) live[`seat:${s.traveler}`] = s.seat;
  }
  for (const [k, v] of entries) if (k !== "person") live[k] = v;
  return live;
}

const subscribeNever = () => () => undefined;

function readLastType(): ItemType | null {
  try {
    const stored = window.sessionStorage.getItem(LAST_TYPE_KEY);
    return TYPES.find((t) => t.type === stored)?.type ?? null;
  } catch {
    return null;
  }
}

function rememberType(type: string): void {
  try {
    window.sessionStorage.setItem(LAST_TYPE_KEY, type);
  } catch {
    return;
  }
}

function Field({ label, name, error, note, children }: { label: string; name: string; error?: string; note?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className={styles.field} data-invalid={error ? "true" : undefined}>
      <label htmlFor={`${id}-${name}`}>{label}</label>
      {children}
      {note && <p className={styles.note}>{note}</p>}
      {error && (
        <p className={styles.error} id={`${id}-${name}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ItemForm(props: ItemFormProps): React.JSX.Element {
  const { tripId, travelers, members, initial, action, hint, canChangeSharing, backHref } = props;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, emptyFormState);
  const [live, setLive] = useState(() => liveFrom(initial, state.values));
  const [hints, setHints] = useState<Record<string, PlaceHint>>({});
  const [people, setPeople] = useState<string[]>(initial?.visibleToUserIds ?? []);
  const [busy, setBusy] = useState(initial?.showAsBusy ?? false);
  const errors = state.errors;
  const remembered = useSyncExternalStore(subscribeNever, readLastType, () => null);
  const type: ItemType = isItemType(live.type) ? live.type : (!initial && state.values.length === 0 && remembered) || "flight";
  const visibility = live.visibility ?? "everyone";
  const hasDetails = DETAIL_FIELDS.some((f) => live[f] || errors[f]) || visibility !== "everyone" || Object.keys(live).some((k) => k.startsWith("seat:") && live[k]);
  const [detailsOpen, setDetailsOpen] = useState(hasDetails);
  const id = useId();

  function track(e: FormEvent<HTMLFormElement>) {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    if (el instanceof HTMLInputElement && el.type === "checkbox") return;
    const edited = /^(checkIn|checkOut)Time$/.exec(el.name);
    setLive((l) => ({ ...l, [el.name]: el.value, ...(edited ? { [`${edited[1]}Edited`]: "1" } : {}) }));
    if (el.name === "type") rememberType(el.value);
  }

  async function resolve(name: string, kind: HintKind, text: string) {
    const key = `${type}:${name}`;
    const result = await hint({ tripId, kind, text, date: DATE_SHAPE.test(live.date ?? live.checkInDate ?? "") ? (live.date ?? live.checkInDate) : undefined });
    setHints((h) => ({ ...h, [key]: result }));
  }

  const hintFor = (name: string): PlaceHint | undefined => hints[`${type}:${name}`];
  const found = (name: string) => {
    const h = hintFor(name);
    return h?.status === "found" ? h : null;
  };
  const zoneNote = (name: string): ReactNode => {
    const h = hintFor(name);
    if (!h || h.status === "empty") return null;
    if (h.status === "missing") return <span className={styles.warning}>{h.message}</span>;
    return (
      <>
        {h.line}
        {h.warning && <span className={styles.warning}> {h.warning}</span>}
      </>
    );
  };
  const timeLabel = (base: string, name: string) => {
    const h = found(name);
    return h ? `${base} (${h.city} time)` : base;
  };

  const placeProps = (name: string, kind: HintKind, placeholder: string) => ({
    id: `${id}-${name}`,
    name,
    placeholder,
    autoComplete: "off",
    autoCapitalize: "words",
    defaultValue: live[name] ?? "",
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${id}-${name}-error` : undefined,
    onBlur: (e: FormEvent<HTMLInputElement>) => {
      void resolve(name, kind, e.currentTarget.value);
    },
  });

  const control = (name: string) => ({
    id: `${id}-${name}`,
    name,
    defaultValue: live[name] ?? "",
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${id}-${name}-error` : undefined,
  });

  const departName = type === "plan" ? "starts" : "departs";
  const arriveName = type === "plan" ? "ends" : "arrives";
  const departClock = live[departName] ?? "";
  const arriveClock = live[arriveName] ?? "";
  const fromZone = found("from")?.zone;
  const toZone = found("to")?.zone;
  const planZone = found("place")?.zone ?? "UTC";
  let overnight: string | null = null;
  if (DATE_SHAPE.test(live.date ?? "") && CLOCK_SHAPE.test(departClock) && CLOCK_SHAPE.test(arriveClock) && !errors[arriveName]) {
    const departLocal = `${live.date}T${departClock}`;
    if ((type === "flight" || type === "transfer") && fromZone && toZone) {
      if (arrivalAfter(departLocal, fromZone, arriveClock, toZone)?.nextDay) overnight = "Lands the next day";
    } else if (type === "plan" && arriveClock < departClock && arrivalAfter(departLocal, planZone, arriveClock, planZone)?.nextDay) {
      overnight = "Ends the next day";
    }
  }

  const flightNumber = live.flightNumber ?? "";
  const needsAirline = type === "flight" && /^[A-Z0-9]{2}\s?\d{1,4}$/i.test(flightNumber) && !airlineFor(flightNumber);
  const checkInEstimated = (live.checkInEdited ?? "0") !== "1";
  const checkOutEstimated = (live.checkOutEdited ?? "0") !== "1";
  const sharingChoices = canChangeSharing && members.length > 0;

  return (
    <form action={formAction} onChange={track} className={styles.form} noValidate>
      <input type="hidden" name="tripId" value={tripId} />
      <fieldset className={styles.types}>
        <legend className={styles.srOnly}>What are you adding</legend>
        {TYPES.map((t) => (
          <label key={t.type} className={styles.type}>
            <input type="radio" name="type" value={t.type} checked={type === t.type} onChange={() => setLive((l) => ({ ...l, type: t.type }))} />
            <span>{t.label}</span>
          </label>
        ))}
      </fieldset>

      {type === "flight" && (
        <>
          <Field label="Flight number" name="flightNumber" error={errors.flightNumber}>
            <input {...control("flightNumber")} placeholder="NH 159" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          </Field>
          {needsAirline && (
            <Field label="Airline" name="airline" error={errors.airline} note="Optional.">
              <input {...control("airline")} autoComplete="off" autoCapitalize="words" />
            </Field>
          )}
          <Field label="Date" name="date" error={errors.date}>
            <input {...control("date")} type="date" />
          </Field>
          <Field label="From" name="from" error={errors.from} note={zoneNote("from")}>
            <input {...placeProps("from", "airport", "JFK or New York")} autoCapitalize="characters" />
          </Field>
          <Field label="To" name="to" error={errors.to} note={zoneNote("to")}>
            <input {...placeProps("to", "airport", "HND or Tokyo")} autoCapitalize="characters" />
          </Field>
          <div className={styles.pair}>
            <Field label={timeLabel("Departs", "from")} name="departs" error={errors.departs}>
              <input {...control("departs")} type="time" />
            </Field>
            <Field label={timeLabel("Arrives", "to")} name="arrives" error={errors.arrives} note={overnight}>
              <input {...control("arrives")} type="time" />
            </Field>
          </div>
        </>
      )}

      {type === "stay" && (
        <>
          <Field label="Name" name="name" error={errors.name}>
            <input {...control("name")} placeholder="Hotel Resol Ueno" autoComplete="off" autoCapitalize="words" />
          </Field>
          <Field label="City or address" name="place" error={errors.place} note={zoneNote("place")}>
            <input {...placeProps("place", "place", "Tokyo")} />
          </Field>
          <div className={styles.pair}>
            <Field label="Check in" name="checkInDate" error={errors.checkInDate}>
              <input {...control("checkInDate")} type="date" />
            </Field>
            <Field label={timeLabel("Time", "place")} name="checkInTime" error={errors.checkInTime} note={checkInEstimated ? "Estimated. Change it if you know." : null}>
              <input {...control("checkInTime")} type="time" defaultValue={live.checkInTime ?? "15:00"} />
            </Field>
          </div>
          <div className={styles.pair}>
            <Field label="Check out" name="checkOutDate" error={errors.checkOutDate}>
              <input {...control("checkOutDate")} type="date" />
            </Field>
            <Field label={timeLabel("Time", "place")} name="checkOutTime" error={errors.checkOutTime} note={checkOutEstimated ? "Estimated. Change it if you know." : null}>
              <input {...control("checkOutTime")} type="time" defaultValue={live.checkOutTime ?? "11:00"} />
            </Field>
          </div>
          <input type="hidden" name="checkInEdited" value={live.checkInEdited ?? "0"} />
          <input type="hidden" name="checkOutEdited" value={live.checkOutEdited ?? "0"} />
        </>
      )}

      {type === "plan" && (
        <>
          <Field label="What" name="title" error={errors.title}>
            <input {...control("title")} placeholder="Tim Ho Wan" autoComplete="off" autoCapitalize="words" />
          </Field>
          <Field label="City or address" name="place" error={errors.place} note={zoneNote("place")}>
            <input {...placeProps("place", "place", "Hong Kong")} />
          </Field>
          <Field label="Date" name="date" error={errors.date}>
            <input {...control("date")} type="date" />
          </Field>
          <div className={styles.pair}>
            <Field label={timeLabel("Starts", "place")} name="starts" error={errors.starts}>
              <input {...control("starts")} type="time" />
            </Field>
            <Field label="Ends" name="ends" error={errors.ends} note={overnight}>
              <input {...control("ends")} type="time" />
            </Field>
          </div>
        </>
      )}

      {type === "transfer" && (
        <>
          <Field label="From" name="from" error={errors.from} note={zoneNote("from")}>
            <input {...placeProps("from", "place", "Hong Kong")} />
          </Field>
          <Field label="To" name="to" error={errors.to} note={zoneNote("to")}>
            <input {...placeProps("to", "place", "Shenzhen")} />
          </Field>
          <Field label="How" name="mode">
            <select {...control("mode")}>
              <option value="">Not sure</option>
              <option value="train">Train</option>
              <option value="ferry">Ferry</option>
              <option value="car">Car</option>
              <option value="bus">Bus</option>
              <option value="border">Border crossing</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Date" name="date" error={errors.date}>
            <input {...control("date")} type="date" />
          </Field>
          <div className={styles.pair}>
            <Field label={timeLabel("Departs", "from")} name="departs" error={errors.departs}>
              <input {...control("departs")} type="time" />
            </Field>
            <Field label={timeLabel("Arrives", "to")} name="arrives" error={errors.arrives} note={overnight}>
              <input {...control("arrives")} type="time" />
            </Field>
          </div>
        </>
      )}

      {detailsOpen ? (
        <section className={styles.details} aria-label="More details">
          <h2 className={styles.detailsTitle}>More details</h2>
          <Field label="Confirmation code" name="confirmationCode">
            <input {...control("confirmationCode")} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          </Field>
          {type === "flight" && travelers.length > 0 && (
            <fieldset className={styles.group}>
              <legend>Seats</legend>
              {travelers.map((t) => (
                <Field key={t.id} label={t.name} name={`seat:${t.id}`}>
                  <input id={`${id}-seat:${t.id}`} name={`seat:${t.id}`} defaultValue={live[`seat:${t.id}`] ?? ""} placeholder="30K" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
                </Field>
              ))}
            </fieldset>
          )}
          <Field label="Phone" name="phone">
            <input {...control("phone")} type="tel" inputMode="tel" autoComplete="off" />
          </Field>
          <Field label="Price" name="price" error={errors.price}>
            <input {...control("price")} inputMode="decimal" placeholder="$240" autoComplete="off" />
          </Field>
          <Field label="Notes" name="notes">
            <textarea id={`${id}-notes`} name="notes" defaultValue={live.notes ?? ""} rows={3} maxLength={4000} />
          </Field>
          <div className={styles.pair}>
            <Field label="Free cancellation until" name="deadlineDate" error={errors.deadlineDate}>
              <input {...control("deadlineDate")} type="date" />
            </Field>
            <Field label="Time" name="deadlineTime" error={errors.deadlineTime}>
              <input {...control("deadlineTime")} type="time" defaultValue={live.deadlineTime ?? "23:59"} />
            </Field>
          </div>
          {sharingChoices && (
            <fieldset className={styles.group}>
              <legend>Who can see this</legend>
              <label className={styles.choice}>
                <input type="radio" name="visibility" value="everyone" defaultChecked={visibility === "everyone"} />
                <span>Everyone on the trip</span>
              </label>
              <label className={styles.choice}>
                <input type="radio" name="visibility" value="only_me" defaultChecked={visibility === "only_me"} />
                <span>Only me</span>
              </label>
              <label className={styles.choice}>
                <input type="radio" name="visibility" value="specific" defaultChecked={visibility === "specific"} />
                <span>Pick people</span>
              </label>
              {visibility === "specific" && (
                <div className={styles.people}>
                  {members.map((m) => (
                    <label key={m.userId} className={styles.choice}>
                      <input
                        type="checkbox"
                        name="person"
                        value={m.userId}
                        defaultChecked={people.includes(m.userId)}
                        onChange={(e) => setPeople((p) => (e.currentTarget.checked ? [...p, m.userId] : p.filter((x) => x !== m.userId)))}
                      />
                      <span>{m.name}</span>
                    </label>
                  ))}
                  {errors.person && (
                    <p className={styles.error} role="alert">
                      {errors.person}
                    </p>
                  )}
                </div>
              )}
              {visibility !== "everyone" && (
                <label className={styles.choice}>
                  <input type="checkbox" name="showAsBusy" defaultChecked={busy} onChange={(e) => setBusy(e.currentTarget.checked)} />
                  <span>
                    Show as busy
                    <span className={styles.note}>Others see a busy block at this time</span>
                  </span>
                </label>
              )}
            </fieldset>
          )}
        </section>
      ) : (
        <button type="button" className={styles.more} onClick={() => setDetailsOpen(true)} aria-expanded="false">
          More details
        </button>
      )}

      <div className={styles.submitBar}>
        {state.message && (
          <p className={styles.error} role="alert">
            {state.message}
          </p>
        )}
        <button type="submit" disabled={pending}>
          {props.submitLabel ?? `Add ${type}`}
        </button>
        <Link href={backHref} className={styles.back}>
          Back to trip
        </Link>
      </div>
    </form>
  );
}
