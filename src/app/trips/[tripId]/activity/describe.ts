import { DateTime } from "@/domain/time/luxon";
import { formatClock, formatDayHeader } from "@/domain/time/format";
import type { ActivityLine } from "@/server/services/activity-service";

export interface Sentence {
  lead: string;
  title: string | null;
  tail: string;
}

export interface Row {
  id: string;
  sentence: Sentence;
  itemId: string | null;
  detail: string;
  canUndo: boolean;
  undoName: string;
}

export interface Group {
  heading: string;
  rows: Row[];
}

function sentenceFor(line: ActivityLine): Sentence {
  const title = line.title;
  switch (line.kind) {
    case "created":
      return { lead: `${line.by} added `, title, tail: "." };
    case "updated":
      return { lead: `${line.by} changed `, title, tail: "." };
    case "deleted":
      return { lead: `${line.by} deleted `, title, tail: "." };
    case "merged":
      return { lead: `${line.by} merged a calendar record into `, title, tail: "." };
    case "undone":
      return { lead: `${line.by} undid a change to `, title, tail: "." };
    case "imported":
      return { lead: `${line.by} brought in ${line.count === 1 ? "1 item" : `${line.count} items`} from ${line.source}.`, title: null, tail: "" };
  }
}

function plain(s: Sentence): string {
  return `${s.lead}${s.title ?? ""}${s.tail}`;
}

function headingFor(at: string, nowMs: number, zone: string): string {
  const day = DateTime.fromISO(at, { zone: "utc" }).setZone(zone);
  const today = DateTime.fromMillis(nowMs, { zone: zone }).startOf("day");
  const diff = Math.round(today.diff(day.startOf("day"), "days").days);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return formatDayHeader(day);
}

export function groupLines(lines: ActivityLine[], nowMs: number, homeZone: string): Group[] {
  const groups: Group[] = [];
  for (const line of lines) {
    const heading = headingFor(line.at, nowMs, homeZone);
    const time = formatClock(DateTime.fromISO(line.at, { zone: "utc" }).setZone(homeZone));
    const detail = [time, line.changed.length ? line.changed.join(" and ") : null, line.via].filter(Boolean).join(" · ");
    const sentence = sentenceFor(line);
    const row: Row = { id: line.id, sentence, itemId: line.itemId, detail, canUndo: line.canUndo, undoName: `Undo: ${plain(sentence).replace(/\.$/, "")}` };
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) last.rows.push(row);
    else groups.push({ heading, rows: [row] });
  }
  return groups;
}
