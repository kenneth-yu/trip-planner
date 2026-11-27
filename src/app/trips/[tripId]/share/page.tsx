import type { Metadata } from "next";
import { notFound } from "next/navigation";
import pageStyles from "../../../ui/page.module.css";
import styles from "./share.module.css";
import { loadTripPage } from "@/server/web";
import { listInvites, listMembers, listUnlinkedTravelers } from "@/server/services/sharing-service";
import { DateTime } from "@/domain/time/luxon";
import { roleName } from "../../../invite/role-words";
import { getViewLinkSettings } from "@/server/services/view-link-service";
import { InviteForm, RemoveControl, RoleControl } from "./forms";
import { LinkControls, ViewerDeadlines } from "./link-controls";
import { revokeInviteAction } from "./actions";

export const metadata: Metadata = { title: "Share", robots: { index: false, follow: false } };

export default async function SharePage({ params }: PageProps<"/trips/[tripId]/share">) {
  const { tripId } = await params;
  const { ctx, requester, view } = await loadTripPage(tripId);
  if (!view.permissions.canManageSharing) notFound();
  const settings = await getViewLinkSettings(ctx, tripId, requester);
  const [members, invites, travelers] = await Promise.all([
    listMembers(ctx, tripId, requester),
    listInvites(ctx, tripId, requester),
    listUnlinkedTravelers(ctx, tripId, requester),
  ]);
  const day = (d: Date) => DateTime.fromJSDate(d, { zone: view.homeZone }).toFormat("LLL d");
  const ordered = [...members].sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
  return (
    <div className={pageStyles.narrow}>
      <section>
        <h2 className={pageStyles.sectionTitle}>Invite someone</h2>
        <InviteForm tripId={tripId} travelers={travelers} pendingIds={invites.map((i) => i.id)} memberIds={members.map((m) => m.userId)} />
      </section>
      <section className={pageStyles.section}>
        <h2 className={pageStyles.sectionTitle}>People on this trip</h2>
        <ul className={pageStyles.list}>
          {ordered.map((m) => (
            <li key={m.userId} className={styles.member}>
              <span>
                {m.name}
                <span className={pageStyles.muted}>
                  {" "}
                  · {roleName(m.role)}
                  {m.isYou && " · You"}
                </span>
              </span>
              {m.role !== "owner" && (
                <span className={styles.actions}>
                  <RoleControl tripId={tripId} userId={m.userId} role={m.role === "viewer" ? "viewer" : "editor"} />
                  <RemoveControl tripId={tripId} userId={m.userId} name={m.name} />
                </span>
              )}
            </li>
          ))}
        </ul>
        {settings.hasViewers && <ViewerDeadlines tripId={tripId} checked={settings.viewersSeeDeadlines} />}
      </section>
      {invites.length > 0 && (
        <section className={pageStyles.section}>
          <h2 className={pageStyles.sectionTitle}>Pending invites</h2>
          <ul className={pageStyles.list}>
            {invites.map((i) => (
              <li key={i.id} className={styles.member}>
                <span>
                  {roleName(i.role)} invite{i.travelerName && ` for ${i.travelerName.split(" ")[0]}`}, created {day(i.createdAt)}, expires {day(i.expiresAt)}
                </span>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="tripId" value={tripId} />
                  <input type="hidden" name="inviteId" value={i.id} />
                  <button className="quiet">Revoke</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={pageStyles.section}>
        <h2 className={pageStyles.sectionTitle}>Link for family and friends</h2>
        <LinkControls tripId={tripId} enabled={settings.enabled} showsDeadlines={settings.showsDeadlines} />
      </section>
    </div>
  );
}
