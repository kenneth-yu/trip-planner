import { describe, expect, it } from "vitest";
import { TRIP_ID } from "@/fixtures/december-trip";
import { noticeMessage, noticeValue } from "./notice";

const OTHER_TRIP = "00000000-0000-4000-8300-0000000000aa";

describe("the one time line after opening an invite", () => {
  it("says what the person joined as", () => {
    const value = noticeValue({ tripId: TRIP_ID, role: "editor", alreadyMember: false, invitedRole: "editor" });
    expect(noticeMessage(value, TRIP_ID)).toBe("You joined as an editor.");
    expect(noticeMessage(noticeValue({ tripId: TRIP_ID, role: "viewer", alreadyMember: false, invitedRole: "viewer" }), TRIP_ID)).toBe("You joined as a viewer.");
  });

  it("says an existing member is already on the trip, and asks for a role change only when the link was higher", () => {
    expect(noticeMessage(noticeValue({ tripId: TRIP_ID, role: "editor", alreadyMember: true, invitedRole: "viewer" }), TRIP_ID)).toBe(
      "You are already on this trip as an editor.",
    );
    expect(noticeMessage(noticeValue({ tripId: TRIP_ID, role: "viewer", alreadyMember: true, invitedRole: "editor" }), TRIP_ID)).toBe(
      "You are already on this trip as a viewer. Ask the trip owner to change your role.",
    );
    expect(noticeMessage(noticeValue({ tripId: TRIP_ID, role: "owner", alreadyMember: true, invitedRole: "editor" }), TRIP_ID)).toBe(
      "You are already on this trip as the owner.",
    );
  });

  it("shows nothing on another trip, for a missing cookie or for a forged value", () => {
    const value = noticeValue({ tripId: TRIP_ID, role: "editor", alreadyMember: false, invitedRole: "editor" });
    expect(noticeMessage(value, OTHER_TRIP)).toBeNull();
    expect(noticeMessage(undefined, TRIP_ID)).toBeNull();
    expect(noticeMessage("joined.admin." + TRIP_ID, TRIP_ID)).toBeNull();
    expect(noticeMessage("<script>", TRIP_ID)).toBeNull();
  });
});
