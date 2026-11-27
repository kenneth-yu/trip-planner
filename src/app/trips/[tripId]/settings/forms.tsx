"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import pageStyles from "../../../ui/page.module.css";
import styles from "./settings.module.css";
import type { RefusalSegment } from "@/domain/travelers/removal";
import { addTravelerAction, linkTravelerAction, removeTravelerAction, renameTravelerAction, renameTripAction, type SettingsResult } from "./actions";

interface Row {
  id: string;
  name: string;
  secondary: string | null;
  unlinked: boolean;
  removable: boolean;
}

interface Member {
  userId: string;
  name: string;
}

function Refusal({ tripId, segments }: { tripId: string; segments: RefusalSegment[] }) {
  return (
    <p role="alert" className={pageStyles.warning}>
      {segments.map((s, i) =>
        "item" in s ? (
          <Link key={i} href={`/trips/${tripId}/items/${s.item.id}`}>
            {s.item.label}
          </Link>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

function useSubmit(run: (form: FormData) => Promise<SettingsResult>, onOk: (result: Extract<SettingsResult, { ok: true }>) => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<RefusalSegment[] | null>(null);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    start(async () => {
      const result = await run(data);
      if (result.ok) {
        setError(null);
        setRefusal(null);
        onOk(result);
      } else {
        setError(result.refusal ? null : result.error);
        setRefusal(result.refusal);
      }
    });
  }
  return { pending, error, refusal, submit };
}

function NameField({ label, hint, defaultValue, error }: { label: string; hint?: string; defaultValue?: string; error: string | null }) {
  const id = useId();
  const noteId = `${id}-note`;
  const hintId = `${id}-hint`;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" name="name" defaultValue={defaultValue} autoComplete="off" aria-describedby={hint ? `${hintId} ${noteId}` : noteId} aria-invalid={error ? true : undefined} />
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      <p id={noteId} role="alert" className={pageStyles.warning}>
        {error}
      </p>
    </div>
  );
}

export function TripNameForm({ tripId, name }: { tripId: string; name: string }) {
  const [saved, setSaved] = useState(false);
  const { pending, error, submit } = useSubmit(renameTripAction, () => setSaved(true));
  return (
    <form onSubmit={submit} onChange={() => setSaved(false)}>
      <input type="hidden" name="tripId" value={tripId} />
      <NameField label="Trip name" defaultValue={name} error={error} />
      <button type="submit" className="quiet" disabled={pending}>
        {pending ? "Saving" : "Save name"}
      </button>
      <p role="status" className={pageStyles.muted}>
        {saved ? "Saved" : ""}
      </p>
    </form>
  );
}

type Mode = "actions" | "rename" | "link" | "remove";

function RenameForm({ tripId, row, onDone, onCancel }: { tripId: string; row: Row; onDone: () => void; onCancel: () => void }) {
  const { pending, error, submit } = useSubmit(renameTravelerAction, onDone);
  return (
    <form onSubmit={submit}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="travelerId" value={row.id} />
      <NameField label="Name" defaultValue={row.name} error={error} />
      <div className={styles.buttons}>
        <button type="submit" disabled={pending}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function LinkForm({ tripId, row, members, onDone, onCancel }: { tripId: string; row: Row; members: Member[]; onDone: () => void; onCancel: () => void }) {
  const { pending, error, submit } = useSubmit(linkTravelerAction, onDone);
  return (
    <form onSubmit={submit}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="travelerId" value={row.id} />
      <fieldset className={styles.group}>
        <legend>Who is {row.name}?</legend>
        {members.map((m) => (
          <label key={m.userId} className={styles.option}>
            <input type="radio" name="userId" value={m.userId} />
            <span>{m.name}</span>
          </label>
        ))}
      </fieldset>
      <p role="alert" className={pageStyles.warning}>
        {error}
      </p>
      <div className={styles.buttons}>
        <button type="submit" disabled={pending}>
          Save
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RemoveForm({ tripId, row, onDone, onCancel }: { tripId: string; row: Row; onDone: (name: string | null) => void; onCancel: () => void }) {
  const { pending, error, refusal, submit } = useSubmit(removeTravelerAction, (r) => onDone(r.name));
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
  }, []);
  return (
    <form onSubmit={submit}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="travelerId" value={row.id} />
      {refusal ? <Refusal tripId={tripId} segments={refusal} /> : <p>Remove {row.name} from the travelers?</p>}
      {error && (
        <p role="alert" className={pageStyles.warning}>
          {error}
        </p>
      )}
      <div className={styles.buttons}>
        <button ref={keep} type="button" onClick={onCancel}>
          {refusal ? "OK" : "Keep"}
        </button>
        {!refusal && (
          <button type="submit" className={`quiet ${styles.danger}`} disabled={pending}>
            Remove
          </button>
        )}
      </div>
    </form>
  );
}

function AddForm({ tripId, onAdded, onCancel }: { tripId: string; onAdded: (id: string) => void; onCancel: () => void }) {
  const { pending, error, submit } = useSubmit(addTravelerAction, (r) => onAdded(r.id ?? ""));
  return (
    <form onSubmit={submit} className={styles.add}>
      <input type="hidden" name="tripId" value={tripId} />
      <NameField label="Name" hint="As it should appear on bookings, like Maya Chen." error={error} />
      <div className={styles.buttons}>
        <button type="submit" disabled={pending}>
          Add
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function TravelerList({ tripId, travelers, linkable }: { tripId: string; travelers: Row[]; linkable: Member[] }) {
  const [open, setOpen] = useState<{ id: string; mode: Mode } | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelKey = open ? `${open.id}:${open.mode}` : "";
  useEffect(() => {
    if (panelKey) panel.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, [panelKey]);

  function close(id: string) {
    setOpen(null);
    requestAnimationFrame(() => rowButtons.current.get(id)?.focus());
  }

  return (
    <div>
      <p role="status" className={pageStyles.muted}>
        {removed ? `Removed ${removed}.` : ""}
      </p>
      <ul className={pageStyles.list}>
        {travelers.map((row) => {
          const isOpen = open?.id === row.id;
          const panelId = `traveler-${row.id}`;
          return (
            <li key={row.id}>
              <button
                type="button"
                className={styles.row}
                aria-expanded={isOpen}
                aria-controls={panelId}
                ref={(el) => {
                  if (el) rowButtons.current.set(row.id, el);
                  else rowButtons.current.delete(row.id);
                }}
                onClick={() => {
                  setAdding(false);
                  setOpen(isOpen ? null : { id: row.id, mode: "actions" });
                }}
              >
                <span className={styles.rowName}>{row.name}</span>
                {row.secondary && <span className={pageStyles.muted}>{row.secondary}</span>}
                {added === row.id && <span className={pageStyles.muted}> Added</span>}
              </button>
              {isOpen && open && (
                <div id={panelId} ref={panel} className={styles.panel}>
                  {open.mode === "actions" && (
                    <div className={styles.actions}>
                      <button type="button" className="quiet" onClick={() => setOpen({ id: row.id, mode: "rename" })}>
                        Rename
                      </button>
                      {row.unlinked && linkable.length > 0 && (
                        <button type="button" className="quiet" onClick={() => setOpen({ id: row.id, mode: "link" })}>
                          Link to an account
                        </button>
                      )}
                      {row.removable && (
                        <button type="button" className={`quiet ${styles.danger} ${styles.remove}`} onClick={() => setOpen({ id: row.id, mode: "remove" })}>
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                  {open.mode === "rename" && <RenameForm tripId={tripId} row={row} onDone={() => close(row.id)} onCancel={() => close(row.id)} />}
                  {open.mode === "link" && <LinkForm tripId={tripId} row={row} members={linkable} onDone={() => close(row.id)} onCancel={() => close(row.id)} />}
                  {open.mode === "remove" && (
                    <RemoveForm
                      tripId={tripId}
                      row={row}
                      onDone={(name) => {
                        setOpen(null);
                        setRemoved(name ?? row.name);
                      }}
                      onCancel={() => close(row.id)}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {adding ? (
        <AddForm
          tripId={tripId}
          onAdded={(id) => {
            setAdding(false);
            setAdded(id);
            setRemoved(null);
            requestAnimationFrame(() => addButton.current?.focus());
          }}
          onCancel={() => {
            setAdding(false);
            requestAnimationFrame(() => addButton.current?.focus());
          }}
        />
      ) : (
        <button
          ref={addButton}
          type="button"
          className={`quiet ${styles.add}`}
          onClick={() => {
            setOpen(null);
            setAdding(true);
          }}
        >
          Add traveler
        </button>
      )}
    </div>
  );
}
