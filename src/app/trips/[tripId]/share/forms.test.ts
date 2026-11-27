import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CreatedInviteState } from "./actions";
import { InviteForm } from "./forms";

const hooks = vi.hoisted(() => {
  const state: { current: CreatedInviteState } = { current: { inviteId: null, travelerId: null, url: null, role: null, error: null } };
  return state;
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useActionState: () => [hooks.current, () => undefined, false] };
});

vi.mock("./actions", () => ({
  changeRoleAction: () => undefined,
  createInviteAction: () => undefined,
  previewRemoval: async () => 0,
  removeMemberAction: () => undefined,
}));

const jacobId = "00000000-0000-4000-8200-000000000002";
const inviteId = "00000000-0000-4000-8400-000000000001";

function render(pendingIds: string[]) {
  return renderToStaticMarkup(
    createElement(InviteForm, { tripId: "t", travelers: [{ id: jacobId, name: "Jacob Feldman" }], pendingIds, memberIds: ["k"] }),
  );
}

describe("the invite form", () => {
  it("shows the form with defaults and one Create button before a link exists", () => {
    const html = render([]);
    expect(html).toContain("Role");
    expect(html).toContain("This is");
    expect(html).toContain("Create invite link");
    expect(html).not.toContain("Copy link");
  });

  it("shows only the result once a link exists, in order, with Create another link", () => {
    hooks.current = { inviteId, travelerId: jacobId, url: "https://trips.test/invite/tpi_x", role: "viewer", error: null };
    const html = render([inviteId]);
    expect(html).not.toContain("<fieldset");
    expect(html).not.toContain("Create invite link");
    expect(html).not.toContain("Someone new");
    const order = [
      "This link is for Jacob.",
      "Invite link",
      "Copy link",
      "One person can join with this link, as a viewer. It expires in 7 days.",
      "You will not see this link again.",
      "Create another link",
    ];
    const positions = order.map((text) => html.indexOf(text));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html.match(/<button(?![^>]*class="quiet")/g)).toHaveLength(1);
  });

  it("leaves out the traveler line for someone new", () => {
    hooks.current = { inviteId, travelerId: null, url: "https://trips.test/invite/tpi_x", role: "editor", error: null };
    expect(render([inviteId])).not.toContain("This link is for");
  });

  it("goes back to the form when the invite was revoked", () => {
    expect(render([])).toContain("Create invite link");
  });
});
