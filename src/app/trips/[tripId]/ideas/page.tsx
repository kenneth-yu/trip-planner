import { inArray } from "drizzle-orm";
import type { Metadata } from "next";
import pageStyles from "../../../ui/page.module.css";
import { freeTime, groupIdeas, ideaCity, type Idea } from "@/domain/ideas/ideas";
import { buildDays } from "@/domain/time/days";
import { firstName } from "@/domain/people/first-name";
import { formatShortDate, toLocal } from "@/domain/time/format";
import * as t from "@/server/db/schema";
import { listIdeas } from "@/server/services/idea-service";
import { loadTripPage } from "@/server/web";
import { IdeasBoard, type DoneRow, type IdeaGroupData, type IdeaRow } from "./ideas-board";

export const metadata: Metadata = { title: "Ideas", robots: { index: false, follow: false } };

function secondLine(idea: Idea): string | null {
  const place = idea.location?.name ?? null;
  const note = idea.note.split("\n")[0] ?? "";
  return [place, note].filter((part) => part && part.length > 0).join(" · ") || null;
}

export default async function IdeasPage({ params }: PageProps<"/trips/[tripId]/ideas">) {
  const { tripId } = await params;
  const { ctx, requester, view } = await loadTripPage(tripId);
  const all = await listIdeas(ctx, tripId, requester);
  const days = buildDays(view);
  const open = all.filter((idea) => idea.state === "open");
  const finished = all.filter((idea) => idea.state === "done");
  const row = (idea: Idea): IdeaRow => {
    const city = ideaCity(idea);
    return {
      id: idea.id,
      title: idea.title,
      second: secondLine(idea),
      city,
      place: idea.location?.name ?? null,
      note: idea.note,
      where: idea.location?.name ?? city ?? "",
      suggestions: city ? freeTime(view, days, city) : [],
    };
  };
  const groups: IdeaGroupData[] = groupIdeas(view, days, open).map((group) => ({ title: group.title, ideas: group.ideas.map(row) }));
  const doers = finished.flatMap((idea) => (idea.doneBy ? [idea.doneBy] : []));
  const names = new Map((doers.length > 0 ? await ctx.db.select({ id: t.users.id, name: t.users.name }).from(t.users).where(inArray(t.users.id, doers)) : []).map((u) => [u.id, u.name]));
  const done: DoneRow[] = finished.map((idea) => {
    const when = idea.doneAt ? formatShortDate(toLocal({ at: idea.doneAt, zone: view.homeZone })) : null;
    const who = idea.doneBy ? names.get(idea.doneBy) : null;
    return { id: idea.id, title: idea.title, doneText: `Done${when ? ` ${when}` : ""}${who ? `, ${firstName(who)}` : ""}` };
  });
  return (
    <div className={pageStyles.narrow}>
      <h2 className={pageStyles.sectionTitle}>Ideas</h2>
      <IdeasBoard tripId={tripId} groups={groups} done={done} canEdit={view.permissions.canEdit} />
    </div>
  );
}
