import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID } from "@/fixtures/december-trip";
import { jacob, testContext } from "@/server/testing";
import type { ServiceContext } from "@/server/services/context";
import { makeFeedLink, turnOffFeedLink } from "@/server/services/feed-service";
import { GET } from "./route";

const world = vi.hoisted(() => {
  const state: { ctx: ServiceContext | null } = { ctx: null };
  return state;
});

vi.mock("@/server/app-context", () => ({
  requestContext: async () => {
    if (!world.ctx) throw new Error("no test context");
    return world.ctx;
  },
}));

beforeEach(async () => {
  world.ctx = (await testContext()).ctx;
});

const get = (token: string) => GET(new Request(`https://trips.test/api/feed/${token}`), { params: Promise.resolve({ token }) });
const tokenFile = async () => {
  if (!world.ctx) throw new Error("no test context");
  return (await makeFeedLink(world.ctx, TRIP_ID, jacob)).url.split("/api/feed/")[1] ?? "";
};

describe("the calendar feed address", () => {
  it("answers a calendar app with the calendar, private to the person, and tells it not to guess its type", async () => {
    const response = await get(await tokenFile());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await response.text()).startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });

  it("also answers the address without the .ics ending", async () => {
    expect((await get((await tokenFile()).replace(/\.ics$/, ""))).status).toBe(200);
  });

  it.each(["", "nonsense", `tpf_${"a".repeat(43)}.ics`, "tpv_whatever.ics"])("answers 404 with no body for %j", async (token) => {
    const response = await get(token);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toContain("private");
  });

  it("answers 404 with no body once the link is turned off", async () => {
    const token = await tokenFile();
    if (!world.ctx) throw new Error("no test context");
    await turnOffFeedLink(world.ctx, TRIP_ID, jacob);
    const response = await get(token);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});
