import type { ServiceContext } from "./context";
import { cachedGeocoder } from "../places/geocoder";
import { zoneOnDateFrom } from "@/domain/import/pipeline";
import { resolvePlace, type GeoHit, type PlaceContext, type PlaceQuery } from "@/domain/time/resolve-place";
import type { VisibleItem } from "@/domain/visibility/project";
import type { Zone } from "@/domain/types";

export function lookupText(q: PlaceQuery): string {
  return [q.address, q.city, q.country].filter(Boolean).join(", ");
}

export async function placeContextFor(ctx: ServiceContext, items: VisibleItem[], homeZone: Zone, queries: PlaceQuery[]): Promise<PlaceContext> {
  const zoneOnDate = zoneOnDateFrom(items, homeZone);
  if (!ctx.geocoder) return { homeZone, zoneOnDate };
  const geocoder = cachedGeocoder(ctx.db, ctx.geocoder);
  const hits = new Map<string, GeoHit | null>();
  for (const q of queries) {
    const text = lookupText(q);
    if (!q.address || hits.has(text)) continue;
    if (resolvePlace(q).status === "sure") continue;
    hits.set(text, await geocoder.lookup(text));
  }
  return { homeZone, zoneOnDate, geocode: (q) => hits.get(lookupText(q)) ?? null };
}
