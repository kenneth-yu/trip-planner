"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import pageStyles from "../../../ui/page.module.css";
import styles from "./share.module.css";
import { roleInWords } from "../../../invite/role-words";
import { changeRoleAction, createInviteAction, previewRemoval, removeMemberAction, type CreatedInviteState } from "./actions";

function subscribeNothing() {
  return () => undefined;
}

const none: CreatedInviteState = { inviteId: null, travelerId: null, url: null, role: null, forName: null, error: null };

export function InviteForm({
  tripId,
  travelers,
  pendingIds,
  memberIds,
  people,
}: {
  tripId: string;
  travelers: { id: string; name: string }[];
  pendingIds: string[];
  memberIds: string[];
  people?: ReactNode;
}) {
  const [state, action, pending] = useActionState(createInviteAction, none);
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [traveler, setTraveler] = useState("new");
  const [hidden, setHidden] = useState<CreatedInviteState | null>(null);
  const [membersSeen, setMembersSeen] = useState(memberIds.join());
  if (membersSeen !== memberIds.join()) {
    setMembersSeen(memberIds.join());
    setHidden(state);
  }
  const shown = state.url !== null && state.role !== null && state !== hidden && state.inviteId !== null && pendingIds.includes(state.inviteId);
  const canShare = useSyncExternalStore(subscribeNothing, () => typeof navigator.share === "function", () => false);
  const [copyProblem, setCopyProblem] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const sentence = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (shown) sentence.current?.focus();
  }, [shown]);

  async function copy(url: string) {
    setCopyProblem(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
    } catch (e) {
      setCopiedUrl(null);
      setCopyProblem(e instanceof Error ? "Could not copy. Select the link and copy it." : "Could not copy.");
    }
  }

  async function share(url: string) {
    try {
      await navigator.share({ url });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) await copy(url);
    }
  }

  if (shown && state.url && state.role) {
    const link = state.url;
    const who = travelers.find((x) => x.id === state.travelerId)?.name.split(" ")[0];
    return (
      <div>
        {state.forName && (
          <p ref={sentence} tabIndex={-1}>
            Send this link to {state.forName}.
          </p>
        )}
        {who && <p>This link is for {who}.</p>}
        <input className={styles.link} readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <div className={pageStyles.row}>
          <button type="button" onClick={() => copy(link)}>
            Copy link
          </button>
          {canShare && (
            <button type="button" className="quiet" onClick={() => share(link)}>
              Share
            </button>
          )}
        </div>
        <p role="status" className={pageStyles.muted}>
          {copiedUrl === link ? "Link copied." : ""}
        </p>
        {copyProblem && (
          <p role="alert" className={pageStyles.warning}>
            {copyProblem}
          </p>
        )}
        <p>One person can join with this link, as {roleInWords(state.role)}. It expires in 7 days.</p>
        <p className={pageStyles.muted}>You will not see this link again. Create a new one if you lose it.</p>
        <button type="button" className="quiet" onClick={() => setHidden(state)}>
          Create another link
        </button>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="tripId" value={tripId} />
      <fieldset className={styles.group}>
        <legend>Role</legend>
        <label className={styles.option}>
          <input type="radio" name="role" value="editor" checked={role === "editor"} onChange={() => setRole("editor")} />
          <span>Editor: can add and change things.</span>
        </label>
        <label className={styles.option}>
          <input type="radio" name="role" value="viewer" checked={role === "viewer"} onChange={() => setRole("viewer")} />
          <span>Viewer: can look, cannot change anything.</span>
        </label>
      </fieldset>
      {travelers.length > 0 && (
        <fieldset className={styles.group}>
          <legend>This is</legend>
          {travelers.map((x) => (
            <label key={x.id} className={styles.option}>
              <input type="radio" name="traveler" value={x.id} checked={traveler === x.id} onChange={() => setTraveler(x.id)} />
              <span>{x.name}</span>
            </label>
          ))}
          <label className={styles.option}>
            <input type="radio" name="traveler" value="new" checked={traveler === "new"} onChange={() => setTraveler("new")} />
            <span>Someone new</span>
          </label>
        </fieldset>
      )}
      {people}
      <button disabled={pending}>{pending ? "Creating link" : "Create invite link"}</button>
      {state.error && (
        <p role="alert" className={pageStyles.warning}>
          {state.error}
        </p>
      )}
    </form>
  );
}

export function RoleControl({ tripId, userId, role }: { tripId: string; userId: string; role: "editor" | "viewer" }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="quiet" onClick={() => setOpen(true)}>
        Change role
      </button>
    );
  }
  return (
    <form action={changeRoleAction} className={styles.inline}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="userId" value={userId} />
      <select name="role" defaultValue={role} aria-label="Role">
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      <button>Save</button>
      <button type="button" className="quiet" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

type Removal = { step: "idle" } | { step: "asking" } | { step: "confirm"; hidden: number };

export function RemoveControl({ tripId, userId, name }: { tripId: string; userId: string; name: string }) {
  const [removal, setRemoval] = useState<Removal>({ step: "idle" });
  const sentence = useRef<HTMLSpanElement>(null);
  const confirming = removal.step === "confirm";
  useEffect(() => {
    if (confirming) sentence.current?.focus();
  }, [confirming]);
  if (removal.step !== "confirm") {
    return (
      <button
        type="button"
        className="quiet"
        disabled={removal.step === "asking"}
        onClick={async () => {
          setRemoval({ step: "asking" });
          setRemoval({ step: "confirm", hidden: await previewRemoval(tripId, userId) });
        }}
      >
        Remove
      </button>
    );
  }
  return (
    <form action={removeMemberAction} className={styles.inline}>
      <input type="hidden" name="tripId" value={tripId} />
      <input type="hidden" name="userId" value={userId} />
      <span ref={sentence} tabIndex={-1} className={styles.sentence}>
        Remove {name.split(" ")[0]}? They lose access to this trip.
        {removal.hidden > 0 && ` Their ${removal.hidden} private ${removal.hidden === 1 ? "item is" : "items are"} deleted too.`}
      </span>
      <button className={`quiet ${styles.danger}`}>Remove {name.split(" ")[0]}</button>
      <button type="button" className="quiet" onClick={() => setRemoval({ step: "idle" })}>
        Cancel
      </button>
    </form>
  );
}
