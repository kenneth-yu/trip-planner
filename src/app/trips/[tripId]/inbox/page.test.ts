import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIP_ID } from "@/fixtures/december-trip";
import { kenny, testContext } from "@/server/testing";
import { getTripView } from "@/server/services/trip-service";
import type { ServiceContext } from "@/server/services/context";
import InboxPage from "./page";

const world = vi.hoisted(() => {
  const holder: { ctx: ServiceContext | null; configured: boolean; canEdit: boolean } = { ctx: null, configured: true, canEdit: true };
  return { holder };
});

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/server/app-context", () => ({ appUrl: () => "https://trips.test" }));
vi.mock("@/server/web", () => ({
  loadTripPage: async () => {
    if (!world.holder.ctx) throw new Error("no test context");
    const view = await getTripView(world.holder.ctx, TRIP_ID, kenny);
    return { ctx: world.holder.ctx, requester: kenny, view: { ...view, permissions: { ...view.permissions, canEdit: world.holder.canEdit } } };
  },
}));
vi.mock("@/server/google/import-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/google/import-guard")>()),
  importOAuthConfig: () => (world.holder.configured ? { clientId: "c", clientSecret: "s", redirectUri: "https://trips.test/api/google/import/callback" } : null),
}));

beforeEach(async () => {
  world.holder.ctx = (await testContext({ withItems: false })).ctx;
  world.holder.configured = true;
  world.holder.canEdit = true;
});

async function render(query: Record<string, string> = {}) {
  const element = await InboxPage({ params: Promise.resolve({ tripId: TRIP_ID }), searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(element);
}

const LINK = `href="/trips/${TRIP_ID}/import/google">Import from Google Calendar</a>`;

describe("the way into the Google import from the inbox", () => {
  it("is in the empty state when Google is configured", async () => {
    const html = await render();
    expect(html).toContain("Nothing waiting. ");
    expect(html).toContain(LINK);
    expect(html).toContain("to bring your bookings in.");
  });

  it("is not there, and the empty state keeps its old line, when Google is not configured", async () => {
    world.holder.configured = false;
    const html = await render();
    expect(html).not.toContain("Import from Google Calendar");
    expect(html).toContain("Nothing waiting. Items from calendars and assistants show up here first.");
  });

  it("is not there for someone who cannot edit the trip", async () => {
    world.holder.canEdit = false;
    expect(await render()).not.toContain("Import from Google Calendar");
  });
});

describe("the line after a Google import", () => {
  it("shows the count from the address as the first status line", async () => {
    const html = await render({ imported: "18", matched: "5" });
    expect(html).toContain("18 events are waiting in your inbox. 5 look like things already on the trip.</p>");
  });

  it.each([[""], [" 7 "], ["1e3"], ["0x10"], ["abc"]])("shows nothing for %j", async (imported) => {
    expect(await render({ imported })).not.toContain("waiting in your inbox");
  });
});
