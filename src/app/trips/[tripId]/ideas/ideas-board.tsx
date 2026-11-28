"use client";

import { useActionState, useState, type ReactNode } from "react";
import pageStyles from "../../../ui/page.module.css";
import styles from "./ideas.module.css";
import { ideaAction, type IdeaState } from "./actions";
import { closesRow } from "./row-state";

export interface IdeaRow {
  id: string;
  title: string;
  second: string | null;
  city: string | null;
  place: string | null;
  note: string;
  where: string;
  visibility: "everyone" | "only_me" | "specific";
  visibleTo: string[];
  mine: boolean;
  suggestions: { label: string; startLocal: string; endLocal: string | null }[];
}

export interface Person {
  userId: string;
  name: string;
}

export interface IdeaGroupData {
  title: string;
  ideas: IdeaRow[];
}

export interface DoneRow {
  id: string;
  title: string;
  doneText: string;
}

type Mode = "actions" | "edit" | "schedule";

const idle: IdeaState = { status: null, error: null, undo: null };

function Hidden({ tripId, ideaId, intent }: { tripId: string; ideaId?: string; intent: string }) {
  return (
    <>
      <input type="hidden" name="tripId" value={tripId} />
      {ideaId && <input type="hidden" name="ideaId" value={ideaId} />}
      <input type="hidden" name="intent" value={intent} />
    </>
  );
}

function Sharing({ idea, people }: { idea?: IdeaRow; people: Person[] }) {
  const [visibility, setVisibility] = useState<IdeaRow["visibility"]>(idea?.visibility ?? "everyone");
  const [chosen, setChosen] = useState<string[]>(idea?.visibleTo ?? []);
  const choices: { value: IdeaRow["visibility"]; label: string }[] = [
    { value: "everyone", label: "Everyone on the trip" },
    { value: "only_me", label: "Only me" },
    { value: "specific", label: "Pick people" },
  ];
  return (
    <fieldset className={styles.suggestions}>
      <legend>Who can see this</legend>
      {choices.map((choice) => (
        <label key={choice.value} className={styles.choice}>
          <input type="radio" name="visibility" value={choice.value} checked={visibility === choice.value} onChange={() => setVisibility(choice.value)} />
          <span>{choice.label}</span>
        </label>
      ))}
      {visibility === "specific" &&
        people.map((person) => (
          <label key={person.userId} className={styles.choice}>
            <input type="checkbox" name="visibleTo" value={person.userId} checked={chosen.includes(person.userId)} onChange={(e) => setChosen(e.target.checked ? [...chosen, person.userId] : chosen.filter((id) => id !== person.userId))} />
            <span>{person.name}</span>
          </label>
        ))}
    </fieldset>
  );
}

function Fields({ idea, people, sharing, focus = false }: { idea?: IdeaRow; people: Person[]; sharing: boolean; focus?: boolean }) {
  const [title, setTitle] = useState(idea?.title ?? "");
  const [where, setWhere] = useState(idea?.where ?? "");
  const [note, setNote] = useState(idea?.note ?? "");
  return (
    <>
      <label className={styles.field}>
        What
        <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="Buy gold" autoFocus={focus} />
      </label>
      <label className={styles.field}>
        Where
        <input name="where" value={where} onChange={(e) => setWhere(e.target.value)} maxLength={300} aria-describedby="idea-where-hint" />
        <span id="idea-where-hint" className={pageStyles.muted}>
          A city, or a specific place. Leave it blank if it could be anywhere.
        </span>
      </label>
      <label className={styles.field}>
        Note
        <textarea name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
      </label>
      {sharing && <Sharing idea={idea} people={people} />}
    </>
  );
}

function Row({ tripId, idea, people, canEdit, open, onToggle, action, pending }: { tripId: string; idea: IdeaRow; people: Person[]; canEdit: boolean; open: boolean; onToggle: () => void; action: (form: FormData) => void; pending: boolean }) {
  const [mode, setMode] = useState<Mode>("actions");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const panel = `idea-${idea.id}`;
  return (
    <li className={styles.row}>
      <button type="button" className={styles.rowButton} aria-expanded={open} aria-controls={panel} onClick={() => { setMode("actions"); onToggle(); }}>
        {idea.title}
        {idea.second && <span className={styles.second}>{idea.second}</span>}
      </button>
      {open && (
        <div id={panel}>
          {!canEdit && idea.note && <p className={pageStyles.muted}>{idea.note}</p>}
          {canEdit && mode === "actions" && (
            <div className={styles.actions}>
              <button type="button" onClick={() => setMode("schedule")} autoFocus>
                Schedule it
              </button>
              <form action={action}>
                <Hidden tripId={tripId} ideaId={idea.id} intent="done" />
                <button className="quiet" disabled={pending}>
                  Did it
                </button>
              </form>
              <button type="button" className="quiet" onClick={() => setMode("edit")}>
                Edit
              </button>
              <form action={action}>
                <Hidden tripId={tripId} ideaId={idea.id} intent="drop" />
                <button className={`quiet ${styles.drop}`} disabled={pending}>
                  Drop it
                </button>
              </form>
            </div>
          )}
          {canEdit && mode === "edit" && (
            <form action={action}>
              <Hidden tripId={tripId} ideaId={idea.id} intent="edit" />
              <Fields idea={idea} people={people} sharing={idea.mine} />
              <button disabled={pending}>Save changes</button>
            </form>
          )}
          {canEdit && mode === "schedule" && (
            <form action={action}>
              <Hidden tripId={tripId} ideaId={idea.id} intent="schedule" />
              <input type="hidden" name="title" value={idea.title} />
              <input type="hidden" name="note" value={idea.note} />
              <input type="hidden" name="city" value={idea.city ?? ""} />
              <input type="hidden" name="place" value={idea.place ?? ""} />
              {idea.city && (
                <fieldset className={styles.suggestions}>
                  <legend>Free time in {idea.city}</legend>
                  {idea.suggestions.length === 0 && <p className={pageStyles.muted}>Your {idea.city} days are full. Pick a date and time.</p>}
                  {idea.suggestions.map((s) => (
                    <button key={s.startLocal} type="button" className="quiet" aria-pressed={start === s.startLocal} onClick={() => setStart(s.startLocal)}>
                      {s.label}
                    </button>
                  ))}
                </fieldset>
              )}
              <label className={styles.field}>
                Starts
                <input type="datetime-local" name="start" value={start} onChange={(e) => setStart(e.target.value)} required />
              </label>
              <label className={styles.field}>
                Ends
                <input type="datetime-local" name="end" value={end} onChange={(e) => setEnd(e.target.value)} />
                <span className={pageStyles.muted}>Optional. One hour if blank.</span>
              </label>
              <button disabled={pending}>Schedule it</button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

export function IdeasBoard({ tripId, groups, done, canEdit, people, startAdding = false }: { tripId: string; groups: IdeaGroupData[]; done: DoneRow[]; canEdit: boolean; people: Person[]; startAdding?: boolean }) {
  const [state, action, pending] = useActionState<IdeaState, FormData>(ideaAction, idle);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(startAdding && canEdit);
  const toggle = (id: string) => setOpenId((now) => (now === id ? null : id));
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (closesRow(state)) setOpenId(null);
  }
  let status: ReactNode = state.status ?? "";
  if (state.status && state.undo) {
    status = (
      <>
        {state.status}{" "}
        <form action={action} style={{ display: "inline" }}>
          <Hidden tripId={tripId} ideaId={state.undo.ideaId} intent={state.undo.intent} />
          <button className="quiet" disabled={pending}>
            Undo
          </button>
        </form>
      </>
    );
  }
  return (
    <div>
      <p role="status">{status}</p>
      <p role="alert" className={pageStyles.warning}>
        {state.error ?? ""}
      </p>
      {groups.length === 0 && <p className={pageStyles.muted}>No ideas yet. Add things you might do here, with or without a place. They show up on that city&apos;s days.</p>}
      {groups.map((group) => (
        <section key={group.title} className={styles.group}>
          <h3 className={pageStyles.sectionTitle}>{group.title}</h3>
          <ul className={styles.list}>
            {group.ideas.map((idea) => (
              <Row key={idea.id} tripId={tripId} idea={idea} people={people} canEdit={canEdit} open={openId === idea.id} onToggle={() => toggle(idea.id)} action={action} pending={pending} />
            ))}
          </ul>
        </section>
      ))}
      {canEdit && (
        <div>
          {adding ? (
            <form action={action} onSubmit={() => setAdding(false)}>
              <Hidden tripId={tripId} intent="add" />
              <Fields people={people} sharing focus />
              <button disabled={pending}>Add idea</button>
            </form>
          ) : (
            <button type="button" className="quiet" onClick={() => setAdding(true)}>
              Add an idea
            </button>
          )}
        </div>
      )}
      {done.length > 0 && (
        <details className={styles.done}>
          <summary>Done ({done.length})</summary>
          <ul className={styles.list}>
            {done.map((row) => (
              <li key={row.id} className={styles.row}>
                <span>{row.title}</span> <span className={styles.second}>{row.doneText}</span>
                {canEdit && (
                  <form action={action}>
                    <Hidden tripId={tripId} ideaId={row.id} intent="notdone" />
                    <button className="quiet" disabled={pending}>
                      Not done
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
