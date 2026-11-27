"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { listTripMembers } from "@/server/services/member-service";
import { quickAddItem } from "@/server/services/trip-service";
import { placeContextFor } from "@/server/services/place-service";
import { RATE_RULES, consumeRateLimit } from "@/server/security/rate-limit";
import { airportFor, FORM_ERROR, MESSAGES, parseItemForm, parseTripId, placeQueryFor, type FormEntries, type ZoneOf } from "@/domain/import/item-form";
import { airportByCode, airportShortName, airportsInCity } from "@/domain/time/places";
import { resolvePlace, type PlaceQuery } from "@/domain/time/resolve-place";
import { localDateKey, zoneLabel } from "@/domain/time/format";
import type { FormState, PlaceHint } from "@/app/ui/item-form/form-state";

const Submission = z.string().uuid();

function entriesOf(form: FormData): FormEntries {
  const out: FormEntries = [];
  for (const [key, value] of form.entries()) if (typeof value === "string" && key !== "tripId" && !key.startsWith("$ACTION")) out.push([key, value]);
  return out;
}

function placeQueriesIn(entries: FormEntries): PlaceQuery[] {
  const type = entries.find(([k]) => k === "type")?.[1];
  if (type === "flight") return [];
  const names = type === "transfer" ? ["from", "to"] : ["place"];
  return entries.filter(([k, v]) => names.includes(k) && v.trim()).map(([, v]) => placeQueryFor(v));
}

export async function addItem(_prev: FormState, form: FormData): Promise<FormState> {
  const tripId = parseTripId(form.get("tripId"));
  if (!tripId) notFound();
  const entries = entriesOf(form);
  const { ctx, user, requester, view } = await loadTripPage(tripId);
  if (!view.permissions.canEdit) notFound();
  if (!(await consumeRateLimit(ctx.db, RATE_RULES.quickAdd, user.id, ctx.now())).allowed) return { errors: {}, message: MESSAGES.tooMany, values: entries };
  const members = await listTripMembers(ctx, tripId, requester);
  const places = await placeContextFor(ctx, view.items, requester.homeZone, placeQueriesIn(entries));
  const zoneOf: ZoneOf = (query, isoDate) => {
    const resolved = resolvePlace(query, { contextZone: places.zoneOnDate?.(isoDate) ?? null, geocoded: places.geocode?.(query) ?? null });
    return resolved.status === "unknown" ? null : resolved.zone;
  };
  const parsed = parseItemForm(entries, { memberIds: members.map((m) => m.userId), zoneOf });
  if (!parsed.ok) return { errors: parsed.errors, message: parsed.errors.form ?? null, values: entries };
  const submission = Submission.safeParse(entries.find(([k]) => k === "submission")?.[1]);
  let landing: string;
  try {
    const item = await quickAddItem(ctx, tripId, requester, parsed.input, parsed.sharing, { idempotencyKey: submission.success ? submission.data : undefined });
    landing = `/trips/${tripId}?day=${localDateKey(item.start)}&added=${item.id}`;
  } catch (e) {
    console.error("Quick add failed", { tripId, error: e instanceof Error ? e.name : "unknown" });
    return { errors: {}, message: FORM_ERROR, values: entries };
  }
  redirect(landing);
}

const HintRequest = z.object({
  tripId: z.string(),
  kind: z.enum(["airport", "place"]),
  text: z.string().max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function placeHint(request: z.input<typeof HintRequest>): Promise<PlaceHint> {
  const parsedRequest = HintRequest.safeParse(request);
  const tripId = parsedRequest.success ? parseTripId(parsedRequest.data.tripId) : null;
  if (!parsedRequest.success || !tripId) notFound();
  const { kind, text, date } = parsedRequest.data;
  const { ctx, user, requester, view } = await loadTripPage(tripId);
  if (!view.permissions.canEdit) notFound();
  const value = text.trim();
  if (!value) return { status: "empty" };
  if (!(await consumeRateLimit(ctx.db, RATE_RULES.placeHint, user.id, ctx.now())).allowed) return { status: "limited", message: MESSAGES.tooMany };
  if (kind === "airport") {
    const code = airportFor(value);
    const airport = code ? airportByCode(code) : null;
    if (!airport) return { status: "missing", message: MESSAGES.place };
    const label = airportsInCity(airport.city).length > 1 ? airportShortName(airport) : null;
    return { status: "found", line: label ? `${airport.city}, ${label}. ${airport.city} time.` : null, city: airport.city, zone: airport.zone, warning: null };
  }
  const query = placeQueryFor(value);
  const places = await placeContextFor(ctx, view.items, requester.homeZone, [query]);
  const day = date ?? ctx.now().toISOString().slice(0, 10);
  const resolved = resolvePlace(query, { contextZone: places.zoneOnDate?.(day) ?? null, geocoded: places.geocode?.(query) ?? null });
  if (resolved.status === "unknown") return { status: "missing", message: resolved.reason };
  const city = resolved.city ?? zoneLabel(resolved.zone);
  return {
    status: "found",
    line: null,
    city,
    zone: resolved.zone,
    warning: resolved.status === "check" ? resolved.reason : null,
  };
}
