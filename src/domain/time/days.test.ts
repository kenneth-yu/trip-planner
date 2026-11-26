import { present } from "@/testing/present";
import { describe, expect, it } from "vitest";
import { buildFixtureTrip, USERS } from "@/fixtures/december-trip";
import { projectTrip } from "../visibility/project";
import { buildDays, whereAt } from "./days";
import { DateTime } from "./luxon";

const view = projectTrip(buildFixtureTrip(), { kind: "member", userId: USERS.kenny.id, homeZone: "America/New_York" });
const days = buildDays(view);
const day = (key: string) => present(days.find((d) => d.key === key));

describe("day by day", () => {
  it("runs Tue Dec 1 to Tue Dec 15 with no gaps", () => {
    expect(days[0].header).toBe("Tue Dec 1");
    expect(present(days.at(-1)).header).toBe("Tue Dec 15");
    expect(days).toHaveLength(15);
  });

  it("NH159 belongs to Dec 1 and Dec 2 opens with the arrival line", () => {
    expect(day("2026-12-01").entries.map((e) => e.kind)).toEqual(["flight"]);
    const first = day("2026-12-02").entries[0];
    expect(first.kind).toBe("arrival");
    if (first.kind === "arrival") expect(`${first.time} ${first.text}`).toBe("5:25am Landed from New York");
  });

  it("travel days name both cities", () => {
    expect(day("2026-12-01").place).toBe("New York to Tokyo");
    expect(day("2026-12-05").place).toBe("Tokyo to Hong Kong");
    expect(day("2026-12-03").place).toBe("Tokyo");
  });

  it("a stay with no known place never decides where you are", () => {
    expect(day("2026-12-11").place).toBe("Hong Kong");
    expect(day("2026-12-12").place).toBe("Hong Kong");
  });

  it("free days say so, and only fixture items appear", () => {
    for (const key of ["2026-12-03", "2026-12-04", "2026-12-07", "2026-12-08", "2026-12-09", "2026-12-11", "2026-12-12"]) {
      expect(day(key).isFree, key).toBe(true);
    }
    expect(day("2026-12-14").entries.map((e) => e.kind)).toEqual(["check_out"]);
  });

  it("stays show check in on the first day and check out on the last, estimated wording", () => {
    const dec6 = day("2026-12-06").entries.filter((e) => e.kind === "check_out" || e.kind === "check_in");
    const texts = dec6.map((e) => ("text" in e ? e.text : ""));
    expect(texts).toContain("Check out by 11:00am: Stanford Hotel");
    expect(texts).toContain("Check in: Mumian Hotel Luohu");
  });

  it("head spa sits on Wed Dec 2 at 6:30pm with a NY reference", () => {
    const spa = present(day("2026-12-02").entries.find((e) => e.kind === "event"));
    expect(spa.kind === "event" && [spa.time, spa.home]).toEqual(["6:30pm", "4:30am NY"]);
  });

  it("NH160 lands on its own departure date, so Dec 15 has no arrival line", () => {
    expect(day("2026-12-15").entries.some((e) => e.kind === "arrival")).toBe(false);
  });
});

describe("whereAt", () => {
  const at = (local: string, zone: string) => DateTime.fromISO(local, { zone }).toMillis();
  it("is in the air during a flight, dated by the departure zone", () => {
    expect(whereAt(at("2026-12-01T10:00", "America/New_York"), view.items, view.homeZone)).toMatchObject({ kind: "air", zone: "America/New_York" });
  });
  it("uses the latest arrival", () => {
    expect(whereAt(at("2026-12-03T12:00", "Asia/Tokyo"), view.items, view.homeZone)).toMatchObject({ city: "Tokyo", zone: "Asia/Tokyo" });
  });
  it("a stay that began after the last arrival wins (moved city with no transport)", () => {
    expect(whereAt(at("2026-12-07T17:00", "Asia/Shanghai"), view.items, view.homeZone)).toMatchObject({ city: "Shenzhen" });
  });
  it("falls back to home before the trip", () => {
    expect(whereAt(at("2026-11-26T12:00", "America/New_York"), view.items, view.homeZone).zone).toBe("America/New_York");
  });
});
