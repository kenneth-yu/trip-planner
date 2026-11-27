# Data model

Field names are suggestions; keep the meaning. All ids are random (UUID or similar), never sequential.

## User
* `id`
* `name`
* `email` (unique)
* `homeZone` (IANA zone, suggested from browser on sign up)
* `showHomeTime` (boolean, default true)
* `createdAt`

Sign in methods are handled by the auth library's own tables.

## Trip
* `id`
* `name`
* `ownerId` (User)
* `viewersSeeDeadlines` (boolean, default false). Applies to invited viewers.
* `createdAt`, `updatedAt`

Start and end dates are derived from items, never stored.

## Membership
* `tripId`, `userId` (unique together)
* `role`: `owner` | `editor` | `viewer`
* `createdAt`

Exactly one owner membership per trip, matching `Trip.ownerId`.

## Invite
* `id`
* `tripId`
* `role`: `editor` | `viewer`
* `travelerId` (optional; the trip's traveler the invitee becomes, set null if that traveler is deleted)
* `tokenHash` (store a hash, never the raw token)
* `createdBy` (User)
* `expiresAt` (default 7 days)
* `acceptedAt`, `acceptedBy` (nullable)
* `revokedAt` (nullable)

## ShareLink
* `tripId` (one active link per trip)
* `tokenHash`
* `enabled` (boolean)
* `showsDeadlines` (boolean, default false)
* `createdAt`, `rotatedAt`

Rotating creates a new token and invalidates the old one immediately.

## Traveler
People on the trip, who may or may not have accounts (a child, a friend who never signs up).
* `id`
* `tripId`
* `name`
* `userId` (nullable, link when they join)

## Item
* `id`
* `tripId`
* `type`: `flight` | `stay` | `plan` | `transfer`
* `title` (for flights, generated from flight number if empty)
* `start`: `{ at: UTC instant, zone: IANA }`
* `end`: `{ at: UTC instant, zone: IANA }`
* `startIsEstimated`, `endIsEstimated` (booleans, for defaulted stay times)
* `location` (name, address, optional coordinates). Flights use `fromAirport` and `toAirport` instead.
* `travelerIds` (list of Traveler)
* `visibility`: `everyone` | `only_me` | `specific`
* `visibleToUserIds` (list, used when `specific`)
* `showAsBusy` (boolean, default false; when hidden, others see a "Busy" block)
* `status`: `confirmed` | `needs_review`
* `notes` (plain text)
* `createdBy`, `createdAt`, `updatedBy`, `updatedAt`

### Flight fields
* `airline`, `flightNumber`
* `fromAirport`, `toAirport` (IATA codes)

### Stay fields
* `propertyName`, `kind` (`hotel` | `rental` | `other`)

### Sensitive fields (never sent to viewers or share link visitors)
Stored per traveler where it differs between travelers:
* `confirmationCode`, `bookingReference`
* `seat`
* `phone`
* `price` (amount and currency)
* `bookingSite` (for example "Priceline trip 157 845 216 25")

Suggested shape: `ItemPrivate { itemId, travelerId (nullable), confirmationCode, seat, ... }`. Two travelers on the same flight are one Item with two ItemPrivate rows.

## Deadline
* `id`
* `itemId`
* `kind`: `free_cancellation` | `partial_refund` | `change` | `other`
* `at`: `{ at: UTC instant, zone: IANA }`
* `consequence` (short text: "Non refundable after this", "First night charged")
* `source`: `manual` | `parsed` (parsed ones show "check terms" until a user confirms)
* `confirmedBy` (nullable)

## ImportBatch and ImportedItem
* `ImportBatch { id, tripId, userId, source: google_calendar | ics | email | manual, createdAt }`
* `ImportedItem { id, batchId, raw (original data, kept for reference), proposed (an Item shaped object), matchItemId (nullable), differences (list of field level disagreements), state: pending | approved | merged | discarded }`

## CheckDismissal
* `tripId`, `checkKey` (stable key for that specific finding), `dismissedBy`, `dismissedAt`

## Activity
* `id`, `tripId`, `actorId`, `at`
* `action` (`created`, `updated`, `deleted`, `imported`, `merged`, `invited`, `role_changed`, ...)
* `itemId` (nullable)
* `before`, `after` (JSON, sensitive fields removed for anyone not allowed to see them when displayed)

Activity on a hidden item is only visible to people who can see that item.
