import { and, eq } from "drizzle-orm";
import styles from "../../../ui/page.module.css";
import { loadTripPage } from "@/server/web";
import * as t from "@/server/db/schema";
import { listAssistantTokens } from "@/server/services/assistant-service";
import { revokeAssistant } from "../actions";
import { AssistantForm, MirrorForm } from "./forms";

const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null);

export default async function ConnectPage({ params }: PageProps<"/trips/[tripId]/connect">) {
  const { tripId } = await params;
  const { ctx, user, view } = await loadTripPage(tripId);
  const tokens = (await listAssistantTokens(ctx, user.id)).filter((tk) => tk.tripId === tripId);
  const [mirror] = await ctx.db.select().from(t.calendarMirrors).where(and(eq(t.calendarMirrors.tripId, tripId), eq(t.calendarMirrors.userId, user.id)));
  const [google] = await ctx.db.select().from(t.googleConnections).where(eq(t.googleConnections.userId, user.id));
  return (
    <div className={styles.narrow}>
      <section>
        <h2 className={styles.sectionTitle}>AI assistants</h2>
        <p className={styles.muted}>
          Let Claude or ChatGPT read this trip and suggest items from your email. You review everything before it is added.
        </p>
        <AssistantForm tripId={tripId} canSuggest={view.permissions.canEdit} />
        {tokens.length > 0 && (
          <ul className={styles.list} style={{ marginTop: 16 }}>
            {tokens.map((tk) => (
              <li key={tk.id}>
                <form action={revokeAssistant} className={styles.row} style={{ marginTop: 0, justifyContent: "space-between" }}>
                  <span>
                    {tk.label}
                    <span className={styles.muted}>
                      {" "}
                      · {tk.scope === "read" ? "read only" : "can suggest"}
                      {tk.lastUsedAt && ` · last used ${when(tk.lastUsedAt)}`}
                    </span>
                  </span>
                  <input type="hidden" name="tripId" value={tripId} />
                  <input type="hidden" name="tokenId" value={tk.id} />
                  <button className="quiet">Disconnect</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Google Calendar</h2>
        <p className={styles.muted}>
          The app keeps its own calendar in your Google account up to date with this trip. It cannot see or change your other calendars. Edit the trip here; changes made in Google are replaced.
        </p>
        {mirror?.enabled && (
          <p className={mirror.lastError ? styles.warning : styles.muted}>
            {mirror.lastError ? `Last sync failed: ${mirror.lastError}` : mirror.lastSyncedAt ? `Last synced ${when(mirror.lastSyncedAt)}` : "Waiting for the first sync"}
            {google?.googleEmail && ` · ${google.googleEmail}`}
          </p>
        )}
        <MirrorForm tripId={tripId} connected={Boolean(google)} enabled={Boolean(mirror?.enabled)} />
      </section>
    </div>
  );
}
