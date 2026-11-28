import { describe, expect, it, vi } from "vitest";
import type { LinkRevealState } from "./actions";
import { revealLink } from "./link-controls";

vi.mock("./actions", () => ({
  enableLinkAction: async () => ({ url: "https://trips.test/v/tpv_enabled", error: null }),
  rotateLinkAction: async () => ({ url: "https://trips.test/v/tpv_rotated", error: null }),
  disableLinkAction: async () => ({ saved: true, error: null }),
  setLinkDeadlinesAction: async () => ({ saved: true, error: null }),
  setViewerDeadlinesAction: async () => ({ saved: true, error: null }),
}));

function form(intent: string) {
  const data = new FormData();
  data.set("intent", intent);
  return data;
}

describe("the link shown after the latest action", () => {
  it("is always the latest result: on, new link, off, on shows the last link and never an earlier one", async () => {
    let state: LinkRevealState = { url: null, error: null };
    state = await revealLink(state, form("enable"));
    expect(state.url).toContain("tpv_enabled");
    state = await revealLink(state, form("rotate"));
    expect(state.url).toContain("tpv_rotated");
    state = await revealLink(state, form("enable"));
    expect(state.url).toContain("tpv_enabled");
    expect(state.url).not.toContain("tpv_rotated");
  });
});
