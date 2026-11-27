import { createHash } from "node:crypto";
import { eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import * as t from "../db/schema";
import type { DbOrTx } from "../repo/trip-repo";
import type { GeoHit } from "@/domain/time/resolve-place";

export interface Geocoder {
  lookup(query: string): Promise<GeoHit | null>;
}

const NominatimResult = z.array(z.object({ lat: z.string(), lon: z.string(), display_name: z.string() }));

export function nominatimGeocoder(opts: { userAgent: string; minIntervalMs?: number; fetchImpl?: typeof fetch; baseUrl?: string }): Geocoder {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const minInterval = opts.minIntervalMs ?? 1100;
  let nextAllowed = 0;
  return {
    async lookup(query) {
      const slot = Math.max(Date.now(), nextAllowed);
      nextAllowed = slot + minInterval;
      const wait = slot - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const url = new URL(opts.baseUrl ?? "https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      const res = await fetchImpl(url, { headers: { "user-agent": opts.userAgent, "accept-language": "en" } });
      if (!res.ok) throw new Error(`Address lookup failed: ${res.status}`);
      const [hit] = NominatimResult.parse(await res.json());
      return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name } : null;
    },
  };
}

export class FakeGeocoder implements Geocoder {
  calls: string[] = [];
  constructor(private readonly known: Record<string, GeoHit>) {}
  async lookup(query: string) {
    this.calls.push(query);
    return this.known[query] ?? null;
  }
}

export function geocodeKey(query: string): string {
  return createHash("sha256").update(query.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
}

const CachedHit = z.object({ lat: z.number(), lng: z.number(), label: z.string() }).nullable();

export const GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const GEOCODE_CACHE_MAX_ROWS = 5000;

export function cachedGeocoder(db: DbOrTx, inner: Geocoder, opts: { now?: () => Date; maxRows?: number } = {}): Geocoder {
  const now = opts.now ?? (() => new Date());
  const maxRows = opts.maxRows ?? GEOCODE_CACHE_MAX_ROWS;
  return {
    async lookup(query) {
      const key = geocodeKey(query);
      const oldest = new Date(now().getTime() - GEOCODE_CACHE_TTL_MS);
      const [row] = await db.select().from(t.geocodeCache).where(eq(t.geocodeCache.key, key));
      if (row && row.createdAt >= oldest) return CachedHit.parse(row.hit);
      const hit = await inner.lookup(query);
      await db.insert(t.geocodeCache).values({ key, hit, createdAt: now() }).onConflictDoUpdate({ target: t.geocodeCache.key, set: { hit, createdAt: now() } });
      await db.delete(t.geocodeCache).where(lt(t.geocodeCache.createdAt, oldest));
      await db.delete(t.geocodeCache).where(sql`${t.geocodeCache.key} in (select ${t.geocodeCache.key} from ${t.geocodeCache} order by ${t.geocodeCache.createdAt} desc offset ${maxRows})`);
      return hit;
    },
  };
}
