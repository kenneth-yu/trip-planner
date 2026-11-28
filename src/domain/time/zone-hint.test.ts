import { describe, expect, it } from "vitest";
import { parseZoneHint } from "./zone-hint";

describe("visitor zone hint", () => {
  it("accepts an IANA zone", () => {
    expect(parseZoneHint("Europe/London")).toBe("Europe/London");
    expect(parseZoneHint("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(parseZoneHint("UTC")).toBe("UTC");
  });

  it("ignores junk, markup, oversized and missing values", () => {
    for (const junk of ["", "Mars/Olympus", "<script>alert(1)</script>", "A".repeat(500), "Europe/London\r\nSet-Cookie: x=1", undefined, null, 5, ["UTC"], "../etc/passwd"]) {
      expect(parseZoneHint(junk)).toBeNull();
    }
  });
});
