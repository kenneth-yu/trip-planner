import { describe, expect, it } from "vitest";
import { InvalidTransition, transition } from "./machine";
import { machine as assistantToken } from "./assistant-token.machine";
import { machine as calendarMirror } from "./calendar-mirror.machine";
import { machine as inboxEntry } from "./inbox-entry.machine";
import { machine as invite } from "./invite.machine";
import { machine as itemVisibility } from "./item-visibility.machine";
import { machine as viewLink } from "./view-link.machine";

describe("inbox entry", () => {
  it("a pending entry is added, merged or discarded, and each is final", () => {
    expect(transition(inboxEntry, "Pending", "add")).toBe("Approved");
    expect(transition(inboxEntry, "Pending", "merge")).toBe("Merged");
    expect(transition(inboxEntry, "Pending", "discard")).toBe("Discarded");
    expect(transition(inboxEntry, "Pending", "decideWithoutChoice")).toBe("Pending");
  });

  it("a decided entry cannot be decided again", () => {
    for (const state of ["Approved", "Merged", "Discarded"] as const) {
      expect(() => transition(inboxEntry, state, "add")).toThrow(InvalidTransition);
      expect(() => transition(inboxEntry, state, "discard")).toThrow(InvalidTransition);
    }
  });
});

describe("calendar mirror", () => {
  it("a failed mirror can resume and ends in sync", () => {
    const syncing = transition(calendarMirror, "Failed", "sync");
    expect(syncing).toBe("Syncing");
    expect(transition(calendarMirror, syncing, "synced")).toBe("InSync");
  });

  it("a sync that hits a Google error ends failed", () => {
    expect(transition(calendarMirror, "Syncing", "failed")).toBe("Failed");
  });

  it("a member who left is torn down and the mirror cannot sync again", () => {
    const state = transition(calendarMirror, "Syncing", "memberLeft");
    expect(state).toBe("TornDown");
    expect(() => transition(calendarMirror, state, "sync")).toThrow(InvalidTransition);
  });

  it("an off mirror cannot sync until it is enabled", () => {
    expect(() => transition(calendarMirror, "Off", "sync")).toThrow(InvalidTransition);
    expect(transition(calendarMirror, "Off", "enable")).toBe("Connecting");
  });

  it("stopping works from in sync, failed and connecting", () => {
    for (const state of ["InSync", "Failed", "Connecting"] as const) expect(transition(calendarMirror, state, "disable")).toBe("Off");
  });
});

describe("assistant token", () => {
  it("a revoked token cannot become active or be used again", () => {
    expect(transition(assistantToken, "Active", "revoke")).toBe("Revoked");
    expect(() => transition(assistantToken, "Revoked", "use")).toThrow(InvalidTransition);
    expect(() => transition(assistantToken, "Revoked", "revoke")).toThrow(InvalidTransition);
  });

  it("using an active token keeps it active", () => {
    expect(transition(assistantToken, "Active", "use")).toBe("Active");
  });
});

describe("item visibility", () => {
  it("hiding then sharing returns to visible", () => {
    expect(transition(itemVisibility, transition(itemVisibility, "Visible", "hide"), "share")).toBe("Visible");
    expect(transition(itemVisibility, transition(itemVisibility, "Visible", "hideShowingBusy"), "share")).toBe("Visible");
  });

  it("a hidden item cannot jump straight between busy and absent", () => {
    expect(() => transition(itemVisibility, "Busy", "hide")).toThrow(InvalidTransition);
  });
});

describe("invite", () => {
  it("a pending invite is accepted, revoked or expires, and then stays that way", () => {
    expect(transition(invite, "Pending", "accept")).toBe("Accepted");
    expect(transition(invite, "Pending", "revoke")).toBe("Revoked");
    expect(transition(invite, "Pending", "expire")).toBe("Expired");
    expect(() => transition(invite, "Revoked", "accept")).toThrow(InvalidTransition);
    expect(() => transition(invite, "Expired", "accept")).toThrow(InvalidTransition);
    expect(() => transition(invite, "Accepted", "revoke")).toThrow(InvalidTransition);
  });
});

describe("view link", () => {
  it("rotating keeps it on, and turning it off requires it to be on", () => {
    expect(transition(viewLink, "Off", "enable")).toBe("On");
    expect(transition(viewLink, "On", "rotate")).toBe("On");
    expect(transition(viewLink, "On", "disable")).toBe("Off");
    expect(() => transition(viewLink, "Off", "rotate")).toThrow(InvalidTransition);
    expect(() => transition(viewLink, "Off", "disable")).toThrow(InvalidTransition);
  });
});
