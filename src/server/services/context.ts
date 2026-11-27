import { randomUUID } from "node:crypto";
import type { Db } from "../db/client";
import { serverEnv } from "../env";
import type { GoogleCalendarApi } from "../google/calendar-api";
import type { Geocoder } from "../places/geocoder";

export interface ServiceContext {
  db: Db;
  now: () => Date;
  newId: () => string;
  onTripChanged: (tripId: string) => void | Promise<void>;
  googleFor?: (userId: string) => Promise<GoogleCalendarApi | null>;
  geocoder?: Geocoder;
  appUrl: string;
}

export function defaultContext(
  db: Db,
  required: Pick<ServiceContext, "onTripChanged">,
  overrides: Partial<Omit<ServiceContext, "db" | "onTripChanged">> = {},
): ServiceContext {
  return {
    db,
    now: () => new Date(),
    newId: () => randomUUID(),
    appUrl: serverEnv().appUrl,
    ...overrides,
    onTripChanged: required.onTripChanged,
  };
}
