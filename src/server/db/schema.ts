import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Difference, ProposedItem } from "@/domain/import/proposal";
import type { FlightDetails, ItemPrivate, Location, StayDetails, TransferDetails } from "@/domain/types";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => ts("created_at").notNull().defaultNow();

export const users = pgTable("users", {
  brokenColumn: text("broken_column"),
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  homeZone: text("home_zone").notNull().default("America/New_York"),
  showHomeTime: boolean("show_home_time").notNull().default(true),
  createdAt: created(),
});

export const authAccounts = pgTable(
  "auth_accounts",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] }), index("auth_accounts_user_idx").on(t.userId)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expires: ts("expires").notNull(),
    createdAt: created(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const authVerificationTokens = pgTable(
  "auth_verification_tokens",
  {
    identifier: text("identifier").notNull(),
    tokenHash: text("token_hash").notNull(),
    expires: ts("expires").notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.tokenHash] })],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

export const trips = pgTable("trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  viewersSeeDeadlines: boolean("viewers_see_deadlines").notNull().default(false),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.userId] })],
);

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["editor", "viewer"] }).notNull(),
  email: text("email"),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  revokedAt: ts("revoked_at"),
  createdAt: created(),
});

export const shareLinks = pgTable("share_links", {
  tripId: uuid("trip_id").primaryKey().references(() => trips.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  showsDeadlines: boolean("shows_deadlines").notNull().default(false),
  createdAt: created(),
  rotatedAt: ts("rotated_at"),
});

export const travelers = pgTable("travelers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
});

export interface ItemDetails {
  flight?: FlightDetails;
  stay?: StayDetails;
  transfer?: TransferDetails;
}

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["flight", "stay", "plan", "transfer"] }).notNull(),
    title: text("title").notNull(),
    startAt: ts("start_at").notNull(),
    startZone: text("start_zone").notNull(),
    endAt: ts("end_at").notNull(),
    endZone: text("end_zone").notNull(),
    startIsEstimated: boolean("start_is_estimated").notNull().default(false),
    endIsEstimated: boolean("end_is_estimated").notNull().default(false),
    location: jsonb("location").$type<Location | null>(),
    details: jsonb("details").$type<ItemDetails>().notNull().default({}),
    travelerIds: jsonb("traveler_ids").$type<string[]>().notNull().default([]),
    visibility: text("visibility", { enum: ["everyone", "only_me", "specific"] }).notNull().default("everyone"),
    visibleToUserIds: jsonb("visible_to_user_ids").$type<string[]>().notNull().default([]),
    showAsBusy: boolean("show_as_busy").notNull().default(false),
    status: text("status", { enum: ["confirmed", "needs_review"] }).notNull().default("confirmed"),
    notes: text("notes").notNull().default(""),
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    createdAt: created(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("items_trip_start_idx").on(t.tripId, t.startAt)],
);

export const itemPrivate = pgTable("item_private", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  travelerId: uuid("traveler_id").references(() => travelers.id, { onDelete: "set null" }),
  data: jsonb("data").$type<Omit<ItemPrivate, "travelerId">>().notNull(),
});

export const deadlines = pgTable("deadlines", {
  id: uuid("id").primaryKey().defaultRandom(),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["free_cancellation", "partial_refund", "change", "other"] }).notNull(),
  at: ts("at").notNull(),
  zone: text("zone").notNull(),
  consequence: text("consequence").notNull(),
  source: text("source", { enum: ["manual", "parsed"] }).notNull(),
  confirmedBy: uuid("confirmed_by").references(() => users.id),
});

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  source: text("source", { enum: ["google_calendar", "ics", "email", "manual", "assistant"] }).notNull(),
  label: text("label").notNull().default(""),
  createdAt: created(),
});

export const importedItems = pgTable(
  "imported_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    raw: jsonb("raw").$type<unknown[]>().notNull(),
    proposed: jsonb("proposed").$type<ProposedItem>().notNull(),
    matchItemId: uuid("match_item_id").references(() => items.id, { onDelete: "set null" }),
    matchStrength: text("match_strength", { enum: ["strong", "possible"] }),
    differences: jsonb("differences").$type<Difference[]>().notNull().default([]),
    matchDifferences: jsonb("match_differences").$type<Difference[]>().notNull().default([]),
    unparsed: jsonb("unparsed").$type<string[]>().notNull().default([]),
    state: text("state", { enum: ["pending", "approved", "merged", "discarded"] }).notNull().default("pending"),
    resultItemId: uuid("result_item_id"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
    createdAt: created(),
  },
  (t) => [index("imported_items_trip_state_idx").on(t.tripId, t.state)],
);

export const checkDismissals = pgTable(
  "check_dismissals",
  {
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    checkKey: text("check_key").notNull(),
    dismissedBy: uuid("dismissed_by").notNull().references(() => users.id),
    dismissedAt: created(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.checkKey] })],
);

export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").notNull().references(() => users.id),
    at: created(),
    action: text("action").notNull(),
    itemId: uuid("item_id"),
    via: text("via").notNull().default("app"),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (t) => [index("activity_trip_at_idx").on(t.tripId, t.at)],
);

export const assistantTokens = pgTable("assistant_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tripId: uuid("trip_id").references(() => trips.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scope: text("scope", { enum: ["read", "propose"] }).notNull().default("propose"),
  createdAt: created(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

export const googleConnections = pgTable("google_connections", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  scope: text("scope").notNull(),
  googleEmail: text("google_email"),
  createdAt: created(),
});

export const calendarMirrors = pgTable(
  "calendar_mirrors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id"),
    includeSensitive: boolean("include_sensitive").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    lastSyncedAt: ts("last_synced_at"),
    lastError: text("last_error"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("calendar_mirrors_trip_user_idx").on(t.tripId, t.userId)],
);

export const mirrorEvents = pgTable(
  "mirror_events",
  {
    mirrorId: uuid("mirror_id").notNull().references(() => calendarMirrors.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    googleEventId: text("google_event_id").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [primaryKey({ columns: [t.mirrorId, t.key] })],
);

export const geocodeCache = pgTable("geocode_cache", {
  key: text("key").primaryKey(),
  hit: jsonb("hit").$type<{ lat: number; lng: number; label: string } | null>(),
  createdAt: created(),
});
