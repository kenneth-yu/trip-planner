import { describe, expect, it } from "vitest";
import { isInvitePath, safeNextPath, signInPath } from "./next-path";

describe("safeNextPath", () => {
  it("keeps same site paths with their query", () => {
    expect(safeNextPath("/trips/x?day=2026-12-05")).toBe("/trips/x?day=2026-12-05");
    expect(safeNextPath("/invite/accept")).toBe("/invite/accept");
    expect(safeNextPath("/invite/accept?t=abc")).toBe("/invite/accept?t=abc");
  });

  it("defaults to the home page", () => {
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });

  it.each([
    "//evil.com",
    "https://evil.com",
    "http://evil.com/trips",
    "/\\evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "trips/x",
    "/%2F/evil.com",
    "/%5Cevil.com",
    "/%252F%252Fevil.com",
    "/%0d%0aSet-Cookie:a=b",
    "/\nhttps://evil.com",
    "/\t/evil.com",
    "%2F%2Fevil.com",
    "/%E0%A4%A",
    `/${"a".repeat(3000)}`,
  ])("rejects %s", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });

  it("builds a sign in link that carries a deep link and drops an unsafe one", () => {
    expect(signInPath("/trips/x?day=2026-12-05")).toBe("/sign-in?next=%2Ftrips%2Fx%3Fday%3D2026-12-05");
    expect(signInPath("https://evil.com")).toBe("/sign-in");
    expect(signInPath(undefined)).toBe("/sign-in");
  });

  it("recognises invite paths", () => {
    expect(isInvitePath("/invite/accept")).toBe(true);
    expect(isInvitePath("/trips/x")).toBe(false);
  });
});
