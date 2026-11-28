"use client";

import { useActionState, useState, type ReactNode } from "react";
import pageStyles from "../../../ui/page.module.css";
import styles from "./ideas.module.css";
import { ideaAction, type IdeaState } from "./actions";

export interface IdeaRow {
  id: string;
  title: string;
  second: string | null;
  city: string | null;
  place: string | null;
  note: string;
  where: string;
  suggestions: { label: string; startLocal: string; endLocal: string | null }[];
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

function Fields({ idea }: { idea?: IdeaRow }) {
  return (
    <>
      <label className={styles.field}>
        What
        <input name="title" defaultValue={idea?.title ?? ""} required maxLength={200} placeholder="Buy gold" />
      </label>
      <label className={styles.field}>
        Where
        <input name="where" defaultValue={idea?.where ?? ""} maxLength={300} aria-describedby="idea-where-hint" />
        <span id="idea-where-hint" className={pageStyles.muted}>
          A city, or a specific place. Leave it blank if it could be anywhere.
        </span>
      </label>
      <label className={styles.field}>
        Note
        <textarea name="note" defaultValue={idea?.note ?? ""} maxLength={2000} rows={2} />
      </label>
    </>
  );
}

function Row({ tripId, idea, canEdit, open, onToggle, action, pending }: { tripId: string; idea: IdeaRow; canEdit: boolean; open: boolean; onToggle: () => void; action: (form: FormData) => void; pending: boolean }) {
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
              <Fields idea={idea} />
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
                    <button key={s.startLocal} type="button" className="quiet" aria-pressed={start === s.startLocal} onClick={() => { setStart(s.startLocal); setEnd(s.endLocal ?? ""); }}>
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

export function IdeasBoard({ tripId, groups, done, canEdit }: { tripId: string; groups: IdeaGroupData[]; done: DoneRow[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState<IdeaState, FormData>(ideaAction, idle);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const toggle = (id: string) => setOpenId((now) => (now === id ? null : id));
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
              <Row key={idea.id} tripId={tripId} idea={idea} canEdit={canEdit} open={openId === idea.id} onToggle={() => toggle(idea.id)} action={action} pending={pending} />
            ))}
          </ul>
        </section>
      ))}
      {canEdit && (
        <div>
          {adding ? (
            <form action={action} onSubmit={() => setAdding(false)}>
              <Hidden tripId={tripId} intent="add" />
              <Fields />
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
