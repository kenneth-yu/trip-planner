import { DateTime } from "@/domain/time/luxon";
import type { CalendarEvent, CalendarEventTime } from "@/domain/import/calendar-event";

function escape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsTime(name: string, t: CalendarEventTime): string {
  if (t.date) return `${name};VALUE=DATE:${t.date.replace(/-/g, "")}`;
  const dateTime = t.dateTime ?? "";
  if (t.timeZone) return `${name};TZID=${t.timeZone}:${DateTime.fromISO(dateTime, { zone: t.timeZone }).toFormat("yyyyMMdd'T'HHmmss")}`;
  return `${name}:${DateTime.fromISO(dateTime, { setZone: true }).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`;
}

export function toIcs(list: CalendarEvent[], extra: string[] = []): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN"];
  list.forEach((ev, i) => {
    lines.push("BEGIN:VEVENT", `UID:event-${i}@example.test`, icsTime("DTSTART", ev.start), icsTime("DTEND", ev.end));
    if (ev.summary) lines.push(`SUMMARY:${escape(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escape(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escape(ev.location)}`);
    lines.push(...extra, "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
