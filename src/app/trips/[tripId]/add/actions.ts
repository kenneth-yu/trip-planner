"use server";

import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { loadTripPage } from "@/server/web";
import { listTripMembers } from "@/server/services/member-service";
import { quickAddItem } from "@/server/services/trip-service";
import { placeContextFor } from "@/server/services/place-service";
import { airportFor, FORM_ERROR, MESSAGES, parseItemForm, placeQueryFor, type FormEntries } from "@/domain/import/item-form";
import { airportByCode, airportShortName, airportsInCity } from "@/domain/time/places";
import { resolvePlace } from "@/domain/time/resolve-place";
import { localDateKey, zoneLabel } from "@/domain/time/format";
import type { FormState, PlaceHint } from "@/app/ui/item-form/form-state";

const TripId = z.string().uuid();

function entriesOf(form: FormData): FormEntries {
  const out: FormEntries = [];
  for (const [key, value] of form.entries()) if (typeof value === "string" && key !== "tripId") out.push([key, value]);
  return out;
}

export async function addItem(_prev: FormState, form: FormData): Promise<FormState> {
  const tripId = TripId.parse(form.get("tripId"));
  const entries = entriesOf(form);
  const { ctx, requester, view } = await loadTripPage(tripId);
  if (!view.permissions.canEdit) notFound();
  const members = await listTripMembers(ctx, tripId, requester);
  const parsed = parseItemForm(entries, members.map((m) => m.userId));
  if (!parsed.ok) return { errors: parsed.errors, message: parsed.errors.form ?? null, values: entries };
  let landing: string;
  try {
    const item = await quickAddItem(ctx, tripId, requester, parsed.input, parsed.sharing);
    landing = `/trips/${tripId}?day=${localDateKey(item.start)}&added=${item.id}`;
  } catch (e) {
    console.error("Quick add failed", { tripId, error: e instanceof Error ? e.name : "unknown" });
    return { errors: {}, message: FORM_ERROR, values: entries };
  }
  redirect(landing);
}

const HintRequest = z.object({
  tripId: TripId,
  kind: z.enum(["airport", "place"]),
  text: z.string().max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function placeHint(request: z.input<typeof HintRequest>): Promise<PlaceHint> {
  const { tripId, kind, text, date } = HintRequest.parse(request);
  const { ctx, requester, view } = await loadTripPage(tripId);
  if (!view.permissions.canEdit) notFound();
  const value = text.trim();
  if (!value) return { status: "empty" };
  if (kind === "airport") {
    const code = airportFor(value);
    const airport = code ? airportByCode(code) : null;
    if (!airport) return { status: "missing", message: MESSAGES.place };
    const label = airportsInCity(airport.city).length > 1 ? airportShortName(airport) : null;
    return { status: "found", line: `${label ? `${airport.city}, ${label}` : airport.city}. ${airport.city} time.`, city: airport.city, zone: airport.zone, warning: null };
  }
  const query = placeQueryFor(value);
  const places = await placeContextFor(ctx, view.items, requester.homeZone, [query]);
  const day = date ?? ctx.now().toISOString().slice(0, 10);
  const resolved = resolvePlace(query, { contextZone: places.zoneOnDate?.(day) ?? null, geocoded: places.geocode?.(query) ?? null });
  if (resolved.status === "unknown") return { status: "missing", message: resolved.reason };
  const city = resolved.city ?? zoneLabel(resolved.zone);
  return {
    status: "found",
    line: `${city}. ${city} time.`,
    city,
    zone: resolved.zone,
    warning: resolved.status === "check" ? resolved.reason : null,
  };
}
