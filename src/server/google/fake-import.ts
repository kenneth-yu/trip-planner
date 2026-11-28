import { fixture } from "@/fixtures/december-trip";
import { FakeGoogleCalendar, MIRROR_DESCRIPTION } from "./calendar-api";

const PRIMARY = "kenny primary";
let account: FakeGoogleCalendar | null = null;

export function fakeImportAccount(): FakeGoogleCalendar {
  if (account) return account;
  const google = new FakeGoogleCalendar();
  const names = [...new Set(fixture.calendarEvents.map((e) => e.calendar))].filter((name): name is string => typeof name === "string");
  for (const name of names) google.seedCalendar(name, fixture.calendarEvents.filter((e) => e.calendar === name), { primary: name === PRIMARY });
  google.seedCalendar("Asia, December 2026 (Trip planner)", [], { description: MIRROR_DESCRIPTION });
  google.seedCalendar("Holidays in United States", [], { id: "en.usa#holiday@group.v.calendar.google.com" });
  account = google;
  return google;
}
