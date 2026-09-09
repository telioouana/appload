import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Direct module imports, never the schema barrel: going through it would pull
// in modules that depend on this one and crash at runtime (TDZ)
import { TRACKING_CHANNEL, TRACKING_SLOT, TRACKING_STATUS, chatConversation, chatMessage } from "@workspace/db/chats";
import { Location } from "@workspace/db/orders";
import { LOCATION_SOURCE, ROUTE_SOURCE } from "@workspace/db/tracking";
import { organization, user } from "@workspace/db/users";

/** Where a trip is in its journey — see `trip.status`. */
export const TRIP_STATUS = ["scheduled", "in-transit", "delivered", "cancelled"] as const;
export type TripStatus = (typeof TRIP_STATUS)[number];

/**
 * A shipment a portal tenant tracks on its own, without an Appload order
 * behind it: a company's own truck, or a load it gave to a carrier off the
 * platform. The tracking machinery is the same as an order's (WhatsApp
 * location requests, position pings, a cached route) but the subject is this
 * row, which is why the trip tables mirror the order ones instead of reusing
 * them — an order's trail must never gain rows that belong to no order.
 *
 * The driver is a phone number and a name, nothing more: no `user` and no
 * `driver` row is required, because the driver is usually not the tenant's
 * own employee. `conversationId` is set on the first request or ping so the
 * thread can be shown next to the trip; chats never point back at trips,
 * which keeps the import one-way and the schema free of a cycle.
 */
export const trip = pgTable(
    "trip",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        // Display reference "TRP-<seq>"
        seq: serial("seq").unique().notNull(),
        // The tenant the trip belongs to, client or carrier
        organizationId: text("organization_id")
            .notNull()
            .references(() => organization.id),
        // The connected partner on the other side, when there is one
        counterpartyOrgId: text("counterparty_org_id").references(() => organization.id),
        driverName: text("driver_name").notNull(),
        // E.164, the WhatsApp channel identity
        driverPhone: text("driver_phone").notNull(),
        conversationId: text("conversation_id").references(() => chatConversation.id, { onDelete: "set null" }),
        // Free text: an off-platform truck has no fleet row to point at
        truckPlate: text("truck_plate"),
        cargoDescription: text("cargo_description"),
        origin: jsonb("origin").$type<Location>().notNull(),
        destination: jsonb("destination").$type<Location>().notNull(),
        status: text("status", { enum: TRIP_STATUS }).default("scheduled").notNull(),
        trackingEnabled: boolean("tracking_enabled").default(true).notNull(),
        startedAt: timestamp("started_at"),
        expectedDeliveryAt: timestamp("expected_delivery_at"),
        deliveredAt: timestamp("delivered_at"),
        createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        index("trip_organization_status_idx").on(table.organizationId, table.status),
        index("trip_counterparty_status_idx").on(table.counterpartyOrgId, table.status),
        // The tracking cron's working set: who is on the road right now
        index("trip_driver_phone_idx").on(table.driverPhone).where(sql`${table.status} = 'in-transit'`),
    ],
);

export type Trip = typeof trip.$inferSelect;
export type CreateTrip = typeof trip.$inferInsert;

/**
 * Cached Google result for a trip's origin → destination leg, one row per
 * trip. Same shape and same rules as `order_route` (tracking.ts): "routes"
 * carries the road polyline, "geocode" only the two endpoints; the place ids
 * are the cache key so an edited address recomputes the row. Deleting the
 * trip takes its route with it — nothing auditable lives here, it is a
 * derived cache.
 */
export const tripRoute = pgTable("trip_route", {
    tripId: text("trip_id")
        .primaryKey()
        .references(() => trip.id, { onDelete: "cascade" }),
    originPlaceId: text("origin_place_id").notNull(),
    destinationPlaceId: text("destination_place_id").notNull(),
    originLat: doublePrecision("origin_lat").notNull(),
    originLng: doublePrecision("origin_lng").notNull(),
    destinationLat: doublePrecision("destination_lat").notNull(),
    destinationLng: doublePrecision("destination_lng").notNull(),
    // Google's encoded polyline; null on "geocode" rows
    encodedPolyline: text("encoded_polyline"),
    distanceMeters: integer("distance_meters"),
    durationSeconds: integer("duration_seconds"),
    source: text("source", { enum: ROUTE_SOURCE }).notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
});

export type TripRoute = typeof tripRoute.$inferSelect;
export type CreateTripRoute = typeof tripRoute.$inferInsert;

/**
 * Driver position pings that make up a trip's trail on the map — the
 * `order_location` shape (tracking.ts) keyed by trip. `chatMessageId` is
 * unique, so a replayed webhook never duplicates a ping; the trip FK is
 * `restrict` because pings are evidence of where the cargo went and are
 * never orphaned, while the conversation and message FKs are `set null` so a
 * thread can be cleaned up without losing the position it reported.
 *
 * The coordinates carry the same CHECK as the order trail: a ping is
 * permanent and shared, and one out-of-range row would frame the whole map
 * around it.
 */
export const tripLocation = pgTable(
    "trip_location",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        tripId: text("trip_id")
            .notNull()
            .references(() => trip.id, { onDelete: "restrict" }),
        conversationId: text("conversation_id").references(() => chatConversation.id, { onDelete: "set null" }),
        // One ping per chat message: the unique constraint is what makes the
        // webhook idempotent
        chatMessageId: text("chat_message_id")
            .unique()
            .references(() => chatMessage.id, { onDelete: "set null" }),
        latitude: doublePrecision("latitude").notNull(),
        longitude: doublePrecision("longitude").notNull(),
        // Label the driver's client attached to the location, when any
        placeName: text("place_name"),
        source: text("source", { enum: LOCATION_SOURCE }).default("whatsapp").notNull(),
        recordedAt: timestamp("recorded_at").defaultNow().notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
        index("trip_location_trip_recorded_idx").on(table.tripId, table.recordedAt),
        check("trip_location_latlng_ck", sql`latitude between -90 and 90 and longitude between -180 and 180`),
    ],
);

export type TripLocation = typeof tripLocation.$inferSelect;
export type CreateTripLocation = typeof tripLocation.$inferInsert;

/**
 * One row per driver location request the portal's tracking cron sends for a
 * trip — the `tracking_request` shape (chats.ts) keyed by trip: two slots a
 * day (08:00 / 17:00 Maputo), up to three attempts per slot, WhatsApp then
 * SMS. The (trip, slotDate, slot, attempt) unique index is what makes cron
 * re-runs idempotent; `externalId` is the join key for delivery reports.
 * All timestamps are UTC; the slot pair encodes the local business time.
 */
export const tripTrackingRequest = pgTable(
    "trip_tracking_request",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        tripId: text("trip_id")
            .notNull()
            .references(() => trip.id, { onDelete: "restrict" }),
        conversationId: text("conversation_id").references(() => chatConversation.id, { onDelete: "set null" }),
        // Local Maputo calendar date, e.g. "2026-08-09" — with slot+attempt
        // it makes cron re-runs idempotent
        slotDate: text("slot_date").notNull(),
        slot: text("slot", { enum: TRACKING_SLOT }).notNull(),
        attempt: integer("attempt").notNull(),
        channel: text("channel", { enum: TRACKING_CHANNEL }).notNull(),
        status: text("status", { enum: TRACKING_STATUS }).default("pending").notNull(),
        // Infobip message id — the join key for delivery reports
        externalId: text("external_id"),
        error: text("error"),
        scheduledFor: timestamp("scheduled_for").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("trip_tracking_request_trip_slot_attempt_uidx")
            .on(table.tripId, table.slotDate, table.slot, table.attempt),
        index("trip_tracking_request_external_idx").on(table.externalId),
    ],
);

export type TripTrackingRequest = typeof tripTrackingRequest.$inferSelect;
export type CreateTripTrackingRequest = typeof tripTrackingRequest.$inferInsert;
