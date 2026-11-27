import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LostInvitePage from "./lost/page";

const world = vi.hoisted(() => {
  const state: { user: { id: string } | null } = { user: null };
  return state;
});

vi.mock("@/server/auth/session", () => ({ currentUser: async () => world.user }));

describe("the lost invite page", () => {
  beforeEach(() => {
    world.user = null;
  });

  it("says only that the invite was lost to a signed out visitor", async () => {
    const html = renderToStaticMarkup(await LostInvitePage());
    expect(html).toContain("We lost track of your invite. Open the invite link again.");
    expect(html).not.toContain("Go to your trips");
    expect(html).not.toContain("<a");
  });

  it("adds one quiet link to the trips for a signed in visitor", async () => {
    world.user = { id: "u" };
    const html = renderToStaticMarkup(await LostInvitePage());
    expect(html).toContain("We lost track of your invite. Open the invite link again.");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain("Go to your trips");
  });
});
