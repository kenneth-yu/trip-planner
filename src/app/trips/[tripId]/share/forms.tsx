"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import pageStyles from "../../../ui/page.module.css";
import styles from "./share.module.css";
import { roleInWords } from "../../../invite/role-words";
import { changeRoleAction, createInviteAction, previewRemoval, removeMemberAction, type CreatedInviteState } from "./actions";

function subscribeNothing() {
  return () => undefined;
}

const none: CreatedInviteState = { url: null, role: null, error: null };

export function InviteForm({ tripId, travelers }: { tripId: string; travelers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createInviteAction, none);
  const canShare = useSyncExternalStore(subscribeNothing, () => typeof navigator.share === "function", () => false);
  const [copyProblem, setCopyProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy(url: string) {
    setCopyProblem(null);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch (e) {
      setCopied(false);
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

  return (
    <form action={action}>
      <input type="hidden" name="tripId" value={tripId} />
      <fieldset className={styles.group}>
        <legend>Role</legend>
        <label className={styles.option}>
          <input type="radio" name="role" value="editor" defaultChecked />
          <span>Editor: can add and change things.</span>
        </label>
        <label className={styles.option}>
          <input type="radio" name="role" value="viewer" />
          <span>Viewer: can look, cannot change anything.</span>
        </label>
      </fieldset>
      {travelers.length > 0 && (
        <fieldset className={styles.group}>
          <legend>This is</legend>
          {travelers.map((x) => (
            <label key={x.id} className={styles.option}>
              <input type="radio" name="traveler" value={x.id} />
              <span>{x.name}</span>
            </label>
          ))}
          <label className={styles.option}>
            <input type="radio" name="traveler" value="new" defaultChecked />
            <span>Someone new</span>
          </label>
        </fieldset>
      )}
      <button disabled={pending}>Create invite link</button>
      {state.error && (
        <p role="alert" className={pageStyles.warning}>
          {state.error}
        </p>
      )}
      {state.url && state.role && (
        <div className={pageStyles.section}>
          <input className={styles.link} readOnly value={state.url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <div className={pageStyles.row}>
            <button type="button" onClick={() => copy(state.url ?? "")}>
              {copied ? "Copied" : "Copy link"}
            </button>
            {canShare && (
              <button type="button" className="quiet" onClick={() => share(state.url ?? "")}>
                Share
              </button>
            )}
          </div>
          {copyProblem && (
            <p role="alert" className={pageStyles.warning}>
              {copyProblem}
            </p>
          )}
          <p>One person can join with this link, as {roleInWords(state.role)}. It expires in 7 days.</p>
          <p className={pageStyles.muted}>You will not see this link again. Create a new one if you lose it.</p>
        </div>
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

export function RemoveControl({ tripId, userId, firstName }: { tripId: string; userId: string; firstName: string }) {
  const [removal, setRemoval] = useState<Removal>({ step: "idle" });
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
      <span>
        Remove {firstName}? They lose access to this trip.
        {removal.hidden > 0 && ` Their ${removal.hidden} private ${removal.hidden === 1 ? "item is" : "items are"} deleted too.`}
      </span>
      <button>Remove</button>
      <button type="button" className="quiet" onClick={() => setRemoval({ step: "idle" })}>
        Cancel
      </button>
    </form>
  );
}
