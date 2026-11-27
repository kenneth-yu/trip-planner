import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CreatedInviteState } from "./actions";
import { InviteForm } from "./forms";
import { PastPeople } from "./past-people";

const hooks = vi.hoisted(() => {
  const state: { current: CreatedInviteState } = { current: { inviteId: null, travelerId: null, url: null, role: null, forName: null, error: null } };
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

const inviteId = "00000000-0000-4000-8400-000000000001";
const names = ["Ada Lovelace", "Bo Chen", "Cy Young", "Di Prince", "Eve Cole", "Fay Wray", "Gus Fring", "Hal Jordan"];
const people = (list: string[]) => list.map((name, i) => ({ id: `00000000-0000-4000-8100-00000000010${i}`, name }));

function render(list: string[]) {
  return renderToStaticMarkup(createElement(PastPeople, { people: people(list) }));
}

describe("people from your trips", () => {
  it("shows nothing at all when nobody qualifies", () => {
    expect(render([])).toBe("");
  });

  it("shows the first five and the true count, as buttons named for the person", () => {
    const html = render(names);
    expect(html).toContain("People from your trips");
    expect(html.match(/<button type="submit"/g)).toHaveLength(5);
    expect(html).toContain("Show all 8");
    expect(html.match(/<span class="[^"]*" aria-hidden="true">\s*Invite\s*<\/span>/g)).toHaveLength(5);
    expect(html).toContain('aria-label="Create an invite link for Ada Lovelace"');
    expect(html).not.toContain("Hal Jordan");
  });

  it("shows no Show all link with exactly five", () => {
    expect(render(names.slice(0, 5))).not.toContain("Show all");
  });

  it("escapes markup in names and carries no email, trip name, count of trips or date", () => {
    const html = render(['<img src=x onerror=alert(1)> Sam']);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/@|suggested|shared|trip\b.*\d/i);
  });

  it("sits inside the invite form between the choices and the Create button, and the result names the person", () => {
    hooks.current = { inviteId: null, travelerId: null, url: null, role: null, forName: null, error: null };
    const form = renderToStaticMarkup(
      createElement(InviteForm, { tripId: "t", travelers: [], pendingIds: [], memberIds: ["k"], people: createElement(PastPeople, { people: people(names.slice(0, 2)) }) }),
    );
    expect(form.indexOf("Role")).toBeLessThan(form.indexOf("People from your trips"));
    expect(form.indexOf("People from your trips")).toBeLessThan(form.indexOf("Create invite link"));
    hooks.current = { inviteId, travelerId: null, url: "https://trips.test/invite/tpi_x", role: "editor", forName: "Jacob", error: null };
    const result = renderToStaticMarkup(createElement(InviteForm, { tripId: "t", travelers: [], pendingIds: [inviteId], memberIds: ["k"] }));
    expect(result).toContain("Send this link to Jacob.");
    expect(result).toContain("One person can join with this link, as an editor. It expires in 7 days.");
    expect(result).not.toContain("People from your trips");
  });
});
