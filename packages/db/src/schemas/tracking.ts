import { sql } from "drizzle-orm";
import { check, doublePrecision, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Direct module imports, never the schema barrel: going through it would pull
// in modules that depend on this one and crash at runtime (TDZ)
import { chatConversation, chatMessage } from "@workspace/db/chats";
import { order } from "@workspace/db/orders";

/** How the stored route was obtained — see `orderRoute.source`. */
export const ROUTE_SOURCE = ["routes", "geocode"] as const;
export type RouteSource = (typeof ROUTE_SOURCE)[number];

/** Where a driver ping came from — see `orderLocation.source`. */
export const LOCATION_SOURCE = ["whatsapp", "manual"] as const;
export type LocationSource = (typeof LOCATION_SOURCE)[number];

/**
 * Cached Google result for an order's loading → offloading leg, one row per
 * order. `source` says how much of it is real: "routes" carries the road
 * polyline with its distance and duration; "geocode" means only the two
 * endpoints could be resolved and the client draws a straight chord between
 * them. The origin/destination place ids are the cache key — when either
 * changes (the order's addresses were edited) the row is recomputed and
 * overwritten, so the map never draws a route for addresses the order no
 * longer has. Deleting the order takes its route with it (cascade): nothing
 * financial or auditable lives here, it is a derived cache.
 */
export const orderRoute = pgTable("order_route", {
    orderId: text("order_id")
        .primaryKey()
        .references(() => order.id, { onDelete: "cascade" }),
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

/**
 * Driver position pings that make up an order's trail on the map. Almost all
 * of them arrive as WhatsApp locations: the webhook flattens a shared
 * location into a "📍 place — <maps url>" chat message, and one row is
 * written per such message — `chatMessageId` is unique, so replays of the
 * same webhook (or a re-run of the backfill) never duplicate a ping.
 * `recordedAt` is when the driver sent it, not when the row was written, and
 * it is what the trail orders by. Manual rows (`source` = "manual") are ops
 * entering a position by hand and carry no chat message.
 *
 * The order FK is `restrict` like the rest of the order's operational trail:
 * pings are evidence of where the cargo went and are never orphaned. The
 * conversation and message FKs are `set null` — a thread can be cleaned up
 * without losing the position it reported.
 *
 * The coordinates carry a CHECK because a ping is permanent (nothing in the
 * app deletes one) and shared: one out-of-range row would frame the whole ops
 * map around it. The webhook already refuses such a pin, this is the floor
 * under every other writer.
 */
export const orderLocation = pgTable(
    "order_location",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        orderId: text("order_id")
            .notNull()
            .references(() => order.id, { onDelete: "restrict" }),
        conversationId: text("conversation_id").references(() => chatConversation.id, { onDelete: "set null" }),
        // One ping per chat message: the unique constraint is what makes the
        // webhook and the backfill idempotent
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
        index("order_location_order_recorded_idx").on(table.orderId, table.recordedAt),
        check("order_location_latlng_ck", sql`latitude between -90 and 90 and longitude between -180 and 180`),
    ],
);

export type OrderRoute = typeof orderRoute.$inferSelect;
export type CreateOrderRoute = typeof orderRoute.$inferInsert;
export type OrderLocation = typeof orderLocation.$inferSelect;
export type CreateOrderLocation = typeof orderLocation.$inferInsert;
