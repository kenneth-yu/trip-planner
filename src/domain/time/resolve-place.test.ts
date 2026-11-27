import { describe, expect, it } from "vitest";
import { resolvePlace } from "./resolve-place";

const TOKYO = "Asia/Tokyo";

describe("resolving a place to a time zone", () => {
  it("is sure about trip cities from the city name or the address", () => {
    expect(resolvePlace({ city: "Shenzhen" })).toMatchObject({ status: "sure", zone: "Asia/Shanghai" });
    expect(resolvePlace({ address: "No.1001 Baoan South Road, Luohu District, Shenzhen, China 518001" })).toMatchObject({ status: "sure", zone: "Asia/Shanghai" });
    expect(resolvePlace({ address: "Hotel Resol Ueno, 7-2-9 Ueno, Taito-ku, Tokyo 110-0005, Japan" })).toMatchObject({ status: "sure", zone: TOKYO });
    expect(resolvePlace({ address: "Onward Building, 528 Nathan Road, Kowloon, Hong Kong" })).toMatchObject({ status: "sure", zone: "Asia/Hong_Kong" });
  });

  it("finds cities that have no airport", () => {
    expect(resolvePlace({ city: "Kyoto" })).toMatchObject({ status: "sure", zone: TOKYO, city: "Kyoto" });
    expect(resolvePlace({ address: "245-2 Kurumayacho, Nakagyo-ku, Kyoto, Japan" })).toMatchObject({ status: "sure", zone: TOKYO });
  });

  it("uses the country when the city is unknown and the country has one time zone", () => {
    expect(resolvePlace({ city: "Nara", country: "Japan" })).toMatchObject({ status: "sure", zone: TOKYO, source: "country" });
  });

  it("does not trust a lone match far from the trip; it uses the trip's time and flags it", () => {
    const r = resolvePlace({ city: "Nara" }, { contextZone: TOKYO });
    expect(r).toMatchObject({ status: "check", zone: TOKYO, source: "trip" });
    expect(r.status === "check" && r.reason).toContain("Mali");
  });

  it("flags names shared by several places, preferring the one near the trip", () => {
    const near = resolvePlace({ city: "Springfield" }, { contextZone: "America/Chicago" });
    expect(near).toMatchObject({ status: "check", zone: "America/Chicago" });
    expect(near.status === "check" && near.reason).toContain("near where you are");
    expect(resolvePlace({ city: "Springfield" })).toMatchObject({ status: "check" });
  });

  it("is sure when a named country removes the ambiguity", () => {
    expect(resolvePlace({ city: "Paris", country: "France" })).toMatchObject({ status: "sure", zone: "Europe/Paris" });
  });

  it("says what is missing when it cannot tell", () => {
    expect(resolvePlace({ city: "Nowheresville" })).toEqual({ status: "unknown", reason: "We could not tell where Nowheresville is. Add the city and country." });
    expect(resolvePlace({ city: "Nowheresville", country: "United States" })).toMatchObject({ status: "unknown" });
  });

  it("trusts an address lookup, and flags it when the city name disagrees", () => {
    const kyoto = { lat: 35.0116, lng: 135.7681, label: "Kyoto, Japan" };
    expect(resolvePlace({ address: "Some lane, Higashiyama" }, { geocoded: kyoto })).toMatchObject({ status: "sure", zone: TOKYO, source: "address lookup" });
    expect(resolvePlace({ city: "Shenzhen" }, { geocoded: kyoto })).toMatchObject({ status: "check", zone: TOKYO });
  });
});
