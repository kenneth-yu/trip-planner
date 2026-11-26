import { buildDays, type DayEntry } from "@/domain/time/days";
import type { DeadlineLine } from "@/domain/deadlines/deadlines";
import type { Finding } from "@/domain/checks/checks";
import type { TripView } from "@/domain/visibility/project";
import type { InboxEntry } from "../services/inbox-service";
import { formatClock, formatShortDate, toLocal } from "@/domain/time/format";

function entryLine(e: DayEntry): string {
  switch (e.kind) {
    case "flight": {
      const c = e.card;
      const tag = c.arrive.tag ? ` (${c.arrive.tag})` : "";
      return `${c.depart.time} ${c.header}: ${c.depart.place} to ${c.arrive.place}, lands ${c.arrive.time}${tag}, ${c.duration} [item ${e.itemId}]`;
    }
    case "arrival":
      return `${e.time} ${e.text}`;
    case "in_air":
      return e.text;
    case "check_in":
    case "check_out":
      return `${e.time} ${e.text}${e.place ? `, ${e.place}` : ""} [item ${e.itemId}]`;
    case "event":
      return `${e.time} ${e.title}${e.place ? `, ${e.place}` : ""} [item ${e.itemId}]`;
    case "busy":
      return `${e.time} Busy`;
  }
}

export function describeTrip(view: TripView, deadlines: DeadlineLine[], findings: Finding[]): string {
  const lines = [`Trip: ${view.trip.name} (id ${view.trip.id})`, `Travelers: ${view.travelers.map((t) => t.name).join(", ")}`, "All times are local to where each thing happens.", ""];
  for (const day of buildDays(view)) {
    lines.push(`${day.header}${day.place ? ` · ${day.place}` : ""}`);
    if (day.isFree) lines.push("  Free day");
    for (const e of day.entries) lines.push(`  ${entryLine(e)}`);
  }
  if (deadlines.length) {
    lines.push("", "Deadlines:");
    for (const d of deadlines) lines.push(`  ${d.sentence}. ${d.exact}${d.needsConfirming ? " (check the booking terms)" : ""}`);
  }
  if (findings.length) {
    lines.push("", "Things to check:");
    for (const f of findings) lines.push(`  ${f.sentence}`);
  }
  return lines.join("\n");
}

export function describeInbox(entries: InboxEntry[]): string {
  if (!entries.length) return "The review inbox is empty.";
  return entries
    .map((e) => {
      const p = e.proposed;
      const when = `${formatShortDate(toLocal(p.start))} ${formatClock(toLocal(p.start))}`;
      const bits = [`${p.type} "${p.title}" ${when}`];
      if (e.match) bits.push(`${e.match.strength} match with "${e.match.title}"`);
      for (const d of e.differences) bits.push(`records disagree on ${d.field}: ${d.values.join(" vs ")}`);
      for (const problem of p.problems) bits.push(problem);
      return `- ${bits.join("; ")} (from ${e.label || e.source})`;
    })
    .join("\n");
}
