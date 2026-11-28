"use client";

import Link from "next/link";
import { createContext, useActionState, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import styles from "./item-form.module.css";
import { emptyFormState, type FormState, type HintKind, type PlaceHint } from "./form-state";
import { airlineFor } from "@/domain/import/airlines";
import { arrivalAfter, dayNote, sameDayClockRoll } from "@/domain/import/arrival";
import { offsetAt } from "@/domain/time/format";
import type { ItemFormValues } from "@/domain/import/item-form";
import type { ItemType } from "@/domain/types";

export type { FormState } from "./form-state";

export type { ItemFormValues };

export interface EditingItem {
  itemId: string;
  focusField: string | null;
  title: string;
}

export interface ItemFormProps {
  tripId: string;
  travelers: { id: string; name: string }[];
  members: { userId: string; name: string }[];
  initial?: ItemFormValues;
  defaultBooked?: boolean;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  hint: (request: { tripId: string; kind: HintKind; text: string; date?: string }) => Promise<PlaceHint>;
  submitLabel?: string;
  canChangeSharing: boolean;
  backHref: string;
  submission?: string;
  editing?: EditingItem;
  backLabel?: string;
}

const TYPES: { type: ItemType; label: string }[] = [
  { type: "flight", label: "Flight" },
  { type: "stay", label: "Stay" },
  { type: "plan", label: "Plan" },
  { type: "transfer", label: "Transfer" },
];

const LAST_TYPE_KEY = "trip-planner:last-add-type";
const DETAIL_FIELDS = ["toAirportHours", "toAirportMinutes", "confirmationCode", "bookingReference", "phone", "price", "notes", "deadlineDate", "deadlineTime", "person"];
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

const FormId = createContext<string | null>(null);

function useFormId(): string {
  const id = useContext(FormId);
  if (id === null) throw new Error("Field must be rendered inside ItemForm so its label and error ids match its control.");
  return id;
}

function Field({ label, name, error, note, reserve, children }: { label: string; name: string; error?: string; note?: ReactNode; reserve?: boolean; children: ReactNode }) {
  const id = useFormId();
  return (
    <div className={styles.field} data-invalid={error ? "true" : undefined}>
      <label htmlFor={`${id}-${name}`}>{label}</label>
      {children}
      {(note || reserve) && <p className={`${styles.note} ${reserve ? styles.reserved : ""}`}>{note}</p>}
      {error && (
        <p className={styles.error} id={`${id}-${name}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function firstName(name: string): string {
  return name.split(" ")[0];
}

export function ItemForm(props: ItemFormProps): React.JSX.Element {
  const id = useId();
  return (
    <FormId.Provider value={id}>
      <ItemFormBody {...props} id={id} />
    </FormId.Provider>
  );
}

function ItemFormBody(props: ItemFormProps & { id: string }): React.JSX.Element {
  const { id, tripId, travelers, members, initial, defaultBooked, action, hint, canChangeSharing, backHref, submission, editing } = props;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, emptyFormState);
  const [live, setLive] = useState(() => liveFrom(initial, state.values));
  const [hints, setHints] = useState<Record<string, PlaceHint>>({});
  const [people, setPeople] = useState<string[]>(initial?.visibleToUserIds ?? []);
  const [busy, setBusy] = useState(initial?.showAsBusy ?? false);
  const errors = state.errors;
  const remembered = useSyncExternalStore(subscribeNever, readLastType, () => null);
  const type: ItemType = isItemType(live.type) ? live.type : (!initial && state.values.length === 0 && remembered) || "flight";
  const visibility = live.visibility ?? "everyone";
  const hasDetails = DETAIL_FIELDS.some((f) => live[f] || errors[f]) || visibility !== "everyone" || Object.keys(live).some((k) => (k.startsWith("seat:") || k.startsWith("code:")) && live[k]) || Boolean(editing?.focusField);
  const [detailsOpen, setDetailsOpen] = useState(hasDetails);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const errorCount = Object.keys(errors).filter((k) => k !== "form").length;
  const focusField = editing?.focusField ?? null;

  useEffect(() => {
    if (!focusField) return;
    const el = document.getElementById(`${id}-${focusField}`);
    el?.focus();
    el?.scrollIntoView({ block: "center" });
  }, [focusField, id]);

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (errorCount >= 2) summaryRef.current?.focus();
    else if (errorCount === 1) formRef.current?.querySelector<HTMLElement>('[data-invalid="true"] :is(input, select, textarea)')?.focus();
  }, [errorCount, state]);

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
    if (h.status === "missing" || h.status === "limited") return errors[name] === h.message ? null : <span className={styles.warning}>{h.message}</span>;
    return (
      <>
        {h.line}
        {h.warning && <span className={styles.warning}>{h.line ? " " : ""}{h.warning}</span>}
      </>
    );
  };
  const sameClock = (a: string, b: string): boolean => {
    const first = found(a);
    const second = found(b);
    if (!first || !second || !DATE_SHAPE.test(live.date ?? "")) return false;
    const noon = `${live.date}T12:00:00.000Z`;
    return offsetAt(first.zone, noon) === offsetAt(second.zone, noon);
  };
  const timeLabel = (base: string, name: string, other?: string) => {
    const h = found(name);
    if (!h || (other && sameClock(name, other))) return base;
    return `${base} (${h.city} time)`;
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
    let overnight: string | null = null;
  if (DATE_SHAPE.test(live.date ?? "") && CLOCK_SHAPE.test(departClock) && CLOCK_SHAPE.test(arriveClock) && !errors[arriveName]) {
    const departLocal = `${live.date}T${departClock}`;
    if ((type === "flight" || type === "transfer") && fromZone && toZone) {
      const arrival = arrivalAfter(departLocal, fromZone, arriveClock, toZone);
      overnight = arrival ? dayNote(arrival.dayOffset, "Lands") : null;
    } else if (type === "plan") {
      overnight = dayNote(sameDayClockRoll(live.date ?? "", departClock, arriveClock).dayOffset, "Ends");
    }
  }

  const signalsBooked = Boolean(live.confirmationCode || live.flightNumber);
  const booked = live.booked ? live.booked !== "no" : signalsBooked || (defaultBooked ?? true);
  const flightNumber = live.flightNumber ?? "";
  const needsAirline = type === "flight" && /^[A-Z0-9]{2}\s?\d{1,4}$/i.test(flightNumber) && !airlineFor(flightNumber);
  const checkInEstimated = (live.checkInEdited ?? "0") !== "1";
  const checkOutEstimated = (live.checkOutEdited ?? "0") !== "1";
  const sharingChoices = canChangeSharing && members.length > 0;

  if (state.gone) {
    return (
      <div className={styles.form}>
        <p role="alert">{state.gone === "denied" ? "You can no longer change this item." : "This item was deleted."}</p>
        <Link href={`/trips/${tripId}`} className={styles.primaryLink}>
          Back to the trip
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} onChange={track} className={styles.form} noValidate ref={formRef}>
      <input type="hidden" name="tripId" value={tripId} />
      {submission && <input type="hidden" name="submission" value={submission} />}
      {editing && <input type="hidden" name="itemId" value={editing.itemId} />}
      {editing && <input type="hidden" name="type" value={type} />}
      {errorCount >= 2 && (
        <p className={styles.error} role="alert" tabIndex={-1} ref={summaryRef}>
          Check the {errorCount} fields marked below.
        </p>
      )}
      {!editing && (
      <fieldset className={styles.types}>
        <legend className={styles.srOnly}>What are you adding</legend>
        {TYPES.map((t) => (
          <label key={t.type} className={styles.type}>
            <input type="radio" name="type" value={t.type} checked={type === t.type} onChange={() => setLive((l) => ({ ...l, type: t.type }))} />
            <span>{t.label}</span>
          </label>
        ))}
      </fieldset>
      )}

      <fieldset className={styles.group}>
        <legend>Is it booked?</legend>
        <label className={styles.choice}>
          <input type="radio" name="booked" value="yes" checked={booked} onChange={() => setLive((l) => ({ ...l, booked: "yes" }))} />
          <span>Yes</span>
        </label>
        <label className={styles.choice}>
          <input type="radio" name="booked" value="no" checked={!booked} onChange={() => setLive((l) => ({ ...l, booked: "no" }))} />
          <span>Not yet</span>
        </label>
      </fieldset>

      {editing && !booked && initial?.fields.booked !== "no" && initial?.losesOnNotYet === true && (
        <div className={styles.field} data-invalid={errors.confirmDrop ? "true" : undefined}>
          <label className={styles.choice}>
            <input type="checkbox" name="confirmDrop" value="yes" aria-describedby={errors.confirmDrop ? `${id}-confirmDrop-error` : undefined} />
            <span>Not yet leaves out the confirmation code, seats and price you saved. Remove them.</span>
          </label>
          {errors.confirmDrop && (
            <p className={styles.error} id={`${id}-confirmDrop-error`} role="alert">
              {errors.confirmDrop}
            </p>
          )}
        </div>
      )}

      {type === "flight" && (
        <>
          <Field label="Flight number" name="flightNumber" error={errors.flightNumber} note={booked ? undefined : "Optional."}>
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
          <Field label="From" name="from" error={errors.from} note={zoneNote("from")} reserve>
            <input {...placeProps("from", "airport", "JFK or New York")} autoCapitalize="characters" />
          </Field>
          <Field label="To" name="to" error={errors.to} note={zoneNote("to")} reserve>
            <input {...placeProps("to", "airport", "HND or Tokyo")} autoCapitalize="characters" />
          </Field>
          <div className={`${styles.pair} ${styles.timed}`}>
            <Field label={timeLabel("Departs", "from", "to")} name="departs" error={errors.departs}>
              <input {...control("departs")} type="time" />
            </Field>
            <Field label={timeLabel("Arrives", "to", "from")} name="arrives" error={errors.arrives} note={overnight ?? (booked ? undefined : "Or leave it blank and say how long the flight takes.")}>
              <input {...control("arrives")} type="time" />
            </Field>
          </div>
          {!booked && (
            <fieldset className={styles.group}>
              <legend>About how long?</legend>
              <div className={styles.pair}>
                <Field label="Hours" name="hours" error={errors.hours}>
                  <input {...control("hours")} inputMode="numeric" autoComplete="off" />
                </Field>
                <Field label="Minutes" name="minutes" error={errors.minutes}>
                  <input {...control("minutes")} inputMode="numeric" autoComplete="off" />
                </Field>
              </div>
            </fieldset>
          )}
        </>
      )}

      {type === "stay" && (
        <>
          <Field label="Name" name="name" error={errors.name}>
            <input {...control("name")} placeholder="Hotel Resol Ueno" autoComplete="off" autoCapitalize="words" />
          </Field>
          <Field label="City or address" name="place" error={errors.place} note={zoneNote("place")} reserve>
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
          <Field label="City or address" name="place" error={errors.place} note={zoneNote("place")} reserve>
            <input {...placeProps("place", "place", "Hong Kong")} />
          </Field>
          <Field label="Date" name="date" error={errors.date}>
            <input {...control("date")} type="date" />
          </Field>
          <div className={styles.pair}>
            <Field label={timeLabel("Starts", "place")} name="starts" error={errors.starts}>
              <input {...control("starts")} type="time" />
            </Field>
            <Field label="Ends" name="ends" error={errors.ends} note={overnight ?? "Optional. One hour if blank."}>
              <input {...control("ends")} type="time" />
            </Field>
          </div>
        </>
      )}

      {type === "transfer" && (
        <>
          <Field label="From" name="from" error={errors.from} note={zoneNote("from")} reserve>
            <input {...placeProps("from", "place", "Hong Kong")} />
          </Field>
          <Field label="To" name="to" error={errors.to} note={zoneNote("to")} reserve>
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
          <div className={`${styles.pair} ${styles.timed}`}>
            <Field label={timeLabel("Departs", "from", "to")} name="departs" error={errors.departs}>
              <input {...control("departs")} type="time" />
            </Field>
            <Field label={timeLabel("Arrives", "to", "from")} name="arrives" error={errors.arrives} note={overnight}>
              <input {...control("arrives")} type="time" />
            </Field>
          </div>
        </>
      )}

      {detailsOpen ? (
        <section className={styles.details} aria-label="More details">
          <h2 className={styles.detailsTitle}>More details</h2>
          {!booked ? null : editing && travelers.length > 1 ? (
            <fieldset className={styles.group}>
              <legend>Confirmation code</legend>
              <p className={styles.note}>Fill in one if you share a code.</p>
              {travelers.map((t) => (
                <Field key={t.id} label={firstName(t.name)} name={`code:${t.id}`} error={errors[`code:${t.id}`]}>
                  <input {...control(`code:${t.id}`)} autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" />
                </Field>
              ))}
            </fieldset>
          ) : (
            <Field label="Confirmation code" name="confirmationCode" error={errors.confirmationCode}>
              <input {...control("confirmationCode")} autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" />
            </Field>
          )}
          {booked && type === "flight" && travelers.length > 0 && (
            <fieldset className={styles.group}>
              <legend>Seats</legend>
              {travelers.map((t) => (
                <Field key={t.id} label={editing ? firstName(t.name) : t.name} name={`seat:${t.id}`}>
                  <input id={`${id}-seat:${t.id}`} name={`seat:${t.id}`} defaultValue={live[`seat:${t.id}`] ?? ""} placeholder="30K" autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" />
                </Field>
              ))}
            </fieldset>
          )}
          {booked && editing && (
            <Field label="Booking reference" name="bookingReference" error={errors.bookingReference}>
              <input {...control("bookingReference")} autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" />
            </Field>
          )}
          {type === "stay" && (
            <fieldset className={styles.group}>
              <legend>About how long to the airport?</legend>
              <p className={styles.note}>Used to say when to leave for your flight. Leave blank if you are not sure.</p>
              <div className={styles.pair}>
                <Field label="Hours" name="toAirportHours" error={errors.toAirportHours}>
                  <input {...control("toAirportHours")} type="number" inputMode="numeric" min={0} max={23} />
                </Field>
                <Field label="Minutes" name="toAirportMinutes" error={errors.toAirportMinutes}>
                  <input {...control("toAirportMinutes")} type="number" inputMode="numeric" min={0} max={59} />
                </Field>
              </div>
            </fieldset>
          )}
          <Field label="Phone" name="phone" error={errors.phone}>
            <input {...control("phone")} type="tel" inputMode="tel" autoComplete="off" />
          </Field>
          {booked && (
            <Field label="Price" name="price" error={errors.price}>
              <input {...control("price")} inputMode="decimal" placeholder="$240" autoComplete="off" />
            </Field>
          )}
          <Field label="Notes" name="notes" error={errors.notes}>
            <textarea id={`${id}-notes`} name="notes" defaultValue={live.notes ?? ""} rows={3} maxLength={4000} />
          </Field>
          {booked && !editing && (type === "flight" || type === "stay") && (
          <div className={styles.pair}>
            <Field label="Free cancellation until" name="deadlineDate" error={errors.deadlineDate}>
              <input {...control("deadlineDate")} type="date" />
            </Field>
            <Field label="Time" name="deadlineTime" error={errors.deadlineTime}>
              <input {...control("deadlineTime")} type="time" defaultValue={live.deadlineTime ?? "23:59"} />
            </Field>
          </div>
          )}
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
          {pending && editing ? "Saving" : (props.submitLabel ?? `Add ${type}`)}
        </button>
        <Link href={backHref} className={styles.back}>
          {props.backLabel ?? "Back to trip"}
        </Link>
      </div>
    </form>
  );
}
