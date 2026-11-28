"use client";

import { useActionState } from "react";
import styles from "../../../ui/page.module.css";
import { connectAssistant, mirrorAction, type ActionState, type TokenState } from "../actions";

export function AssistantForm({ tripId, canSuggest }: { tripId: string; canSuggest: boolean }) {
  const [state, action, pending] = useActionState<TokenState, FormData>(connectAssistant, { url: null });
  return (
    <form action={action}>
      <input type="hidden" name="tripId" value={tripId} />
      <div className={styles.row}>
        <input name="label" placeholder="Name, like Jacob's Claude" required maxLength={80} />
        {canSuggest ? (
          <select name="scope" defaultValue="propose" aria-label="What this link can do">
            <option value="propose">Can suggest items</option>
            <option value="read">Read only</option>
          </select>
        ) : (
          <input type="hidden" name="scope" value="read" />
        )}
        <button disabled={pending}>Make a link</button>
      </div>
      {state.url && (
        <div className={styles.section} style={{ marginTop: 16 }}>
          <p>Copy this now. It is shown once and works like a password.</p>
          <code className={styles.code}>{state.url}</code>
          <p className={styles.muted}>
            Claude: Settings, Connectors, Add custom connector, paste the link. ChatGPT: Settings, Connectors, Create, paste the link as the MCP server URL. Claude Code:
            <code> claude mcp add --transport http trips {state.url}</code>
          </p>
        </div>
      )}
    </form>
  );
}

export function MirrorForm({ tripId, connected, enabled }: { tripId: string; connected: boolean; enabled: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(mirrorAction, { message: null, error: false });
  return (
    <form action={action}>
      <input type="hidden" name="tripId" value={tripId} />
      <div className={styles.row}>
        {!connected || !enabled ? (
          <button name="action" value="connect" disabled={pending}>Mirror to Google Calendar</button>
        ) : (
          <>
            <button name="action" value="sync" disabled={pending}>Sync now</button>
            <button name="action" value="off" className="quiet" disabled={pending}>Stop mirroring</button>
          </>
        )}
      </div>
      {state.message && <p className={state.error ? styles.warning : styles.muted}>{state.message}</p>}
    </form>
  );
}
