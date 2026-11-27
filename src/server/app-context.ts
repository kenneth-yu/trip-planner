import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "./db/client";
import * as t from "./db/schema";
import { decryptSecret } from "./auth/tokens";
import { googleCalendarRest } from "./google/calendar-api";
import { accessTokenSource, googleOAuthConfig } from "./google/oauth";
import { defaultContext, type ServiceContext } from "./services/context";
import { syncTripMirrors } from "./services/mirror-service";
import { serverEnv } from "./env";
import { nominatimGeocoder, type Geocoder } from "./places/geocoder";

export function appUrl(): string {
  return serverEnv().appUrl;
}

function geocoderFromEnv(): Geocoder | undefined {
  if (process.env.ADDRESS_LOOKUP !== "openstreetmap") return undefined;
  return nominatimGeocoder({ userAgent: process.env.ADDRESS_LOOKUP_USER_AGENT ?? "trip-planner (self-hosted)" });
}

const geocoder = geocoderFromEnv();

export async function requestContext(): Promise<ServiceContext> {
  const db = await getDb();
  const ctx = defaultContext(
    db,
    {
      onTripChanged: (tripId) => {
        after(async () => {
          const outcomes = await syncTripMirrors(ctx, tripId);
          for (const o of outcomes) if (o.status === "failed") console.error(`Calendar mirror for ${o.userId} on ${tripId} failed: ${o.error}`);
        });
      },
    },
    {
      appUrl: appUrl(),
      geocoder,
      googleFor: async (userId) => {
        const cfg = googleOAuthConfig(appUrl());
        if (!cfg) return null;
        const [conn] = await db.select().from(t.googleConnections).where(eq(t.googleConnections.userId, userId));
        if (!conn) return null;
        return googleCalendarRest(accessTokenSource(cfg, decryptSecret(conn.refreshTokenEnc)));
      },
    },
  );
  return ctx;
}
