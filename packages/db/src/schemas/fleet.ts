import { pgTable, text, timestamp, integer, index, jsonb, serial, pgEnum, } from "drizzle-orm/pg-core";

// Direct module import, never the schema barrel — the barrel re-exports
// modules that depend on this one, and the cycle crashes at runtime (TDZ)
import { organization, user } from "@workspace/db/users";
import { FLEET_STATUS, KYC_STATUS, OWNERSHIP_STATUS, TRUCK_TYPE } from "@workspace/db/types";

import type { LoadingBay, Urls} from "@workspace/db/types";

export const truckEnum = pgEnum("truck_enum", TRUCK_TYPE)
export const fleetEnum = pgEnum("fleet_enum", FLEET_STATUS)

export const driver = pgTable(
    "driver",
    {
        id: text("id").primaryKey().$default(() => crypto.randomUUID()),
        legacyId: serial("legacy_id").unique().notNull(),
        userId: text("user_id")
            .unique()
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        carrierId: text("carrier_id")
            .notNull()
            .references(() => organization.id, { onDelete: "cascade" }),
        truckId: text("truck_id")
            .references(() => truck.id, { onDelete: "set null" }),
            
        passport: text("passport"),
        // Superseded by kyc_document; kept until the empty columns are dropped
        driverLicense: jsonb("driver_card").$type<Urls>(),
        passportCard: jsonb("passport_card").$type<Urls>(),
        // Operational availability, not verification — the two are independent
        status: fleetEnum("status").default("idle").notNull(),
        kycStatus: text("kyc_status", { enum: KYC_STATUS }).default("draft").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    }
)

export const truck = pgTable(
    "truck",
    {
        id: text("id").primaryKey().$default(() => crypto.randomUUID()),
        legacyId: serial("legacy_id").unique().notNull(),
        internalId: text("internal_id"),
        carrierId: text("carrier_id")
            .notNull()
            .references(() => organization.id, { onDelete: "cascade" }),
        regPlate: text("reg_plate").unique().notNull(),

        brand: text("brand").notNull(),
        model: text("model").notNull(),
        year: integer("year").notNull(),
        type: truckEnum("type").notNull(),
        loadingBay: jsonb("loading_bay").$type<LoadingBay>(),
        vin: text("vin").notNull().unique(),
        // Superseded by kyc_document; kept until the empty columns are dropped
        booklet: jsonb("booklet").$type<Urls>(),
        license: jsonb("license").$type<Urls>(),
        // Operational availability, not verification — the two are independent
        status: fleetEnum("status").default("idle").notNull(),
        kycStatus: text("kyc_status", { enum: KYC_STATUS }).default("draft").notNull(),

        // Transcribed from proof-of-ownership at review time and compared
        // against the carrier's own NUIT. A mismatch is what makes a carrier
        // a High-Risk Subcontractor, so it is never inferred silently.
        ownershipStatus: text("ownership_status", { enum: OWNERSHIP_STATUS })
            .default("unverified")
            .notNull(),
        ownerName: text("owner_name"),
        ownerNuit: text("owner_nuit"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        index("truck_carrierId_idx").on(table.carrierId),
        index("truck_plate_idx").on(table.regPlate),
    ]
)

export const trailer = pgTable(
    "trailer",
    {
        id: text("id").primaryKey().$default(() => crypto.randomUUID()),
        legacyId: serial("legacy_id").unique().notNull(),
        internalId: text("internal_id"),
        carrierId: text("carrier_id")
            .notNull()
            .references(() => organization.id, { onDelete: "cascade" }),
        truckId: text("truck_id")
            .references(() => truck.id, { onDelete: "set null" }),

        regPlate: text("reg_plate").unique().notNull(),
        brand: text("brand").notNull(),
        model: text("model").notNull(),
        year: integer("year").notNull(),
        loadingBay: jsonb("loading_bay").$type<LoadingBay>().notNull(),
        vin: text("vin").notNull().unique(),
        // Superseded by kyc_document; kept until the empty columns are dropped
        booklet: jsonb("booklet").$type<Urls>(),
        license: jsonb("license").$type<Urls>(),
        // Operational availability, not verification — the two are independent
        status: fleetEnum("status").default("idle").notNull(),
        kycStatus: text("kyc_status", { enum: KYC_STATUS }).default("draft").notNull(),

        // Transcribed from proof-of-ownership at review time and compared
        // against the carrier's own NUIT. A mismatch is what makes a carrier
        // a High-Risk Subcontractor, so it is never inferred silently.
        ownershipStatus: text("ownership_status", { enum: OWNERSHIP_STATUS })
            .default("unverified")
            .notNull(),
        ownerName: text("owner_name"),
        ownerNuit: text("owner_nuit"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        index("trailer_carrierId_idx").on(table.carrierId),
        index("trailer_plate_idx").on(table.regPlate),
    ]
)

export const link = pgTable(
    "link",
    {
        id: text("id").primaryKey().$default(() => crypto.randomUUID()),
        legacyId: serial("legacy_id").unique().notNull(),
        internalId: text("internal_id"),
        carrierId: text("carrier_id")
            .notNull()
            .references(() => organization.id, { onDelete: "cascade" }),
        trailerId: text("trailer_id")
            .references(() => trailer.id, { onDelete: "set null" }),

        regPlate: text("reg_plate").unique().notNull(),
        brand: text("brand").notNull(),
        model: text("model").notNull(),
        year: integer("year").notNull(),
        loadingBay: jsonb("loading_bay").$type<LoadingBay>().notNull(),
        vin: text("vin").notNull().unique(),
        // Superseded by kyc_document; kept until the empty columns are dropped
        booklet: jsonb("booklet").$type<Urls>(),
        license: jsonb("license").$type<Urls>(),
        // Operational availability, not verification — the two are independent
        status: fleetEnum("status").default("idle").notNull(),
        kycStatus: text("kyc_status", { enum: KYC_STATUS }).default("draft").notNull(),

        // Transcribed from proof-of-ownership at review time and compared
        // against the carrier's own NUIT. A mismatch is what makes a carrier
        // a High-Risk Subcontractor, so it is never inferred silently.
        ownershipStatus: text("ownership_status", { enum: OWNERSHIP_STATUS })
            .default("unverified")
            .notNull(),
        ownerName: text("owner_name"),
        ownerNuit: text("owner_nuit"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        index("link_carrierId_idx").on(table.carrierId),
        index("link_plate_idx").on(table.regPlate),
    ]
)

export type Driver = typeof driver.$inferSelect
export type CreateDriver = typeof driver.$inferInsert

export type Truck = typeof truck.$inferSelect
export type CreateTruck = typeof truck.$inferInsert

export type Trailer = typeof trailer.$inferSelect
export type CreateTrailer = typeof trailer.$inferInsert

export type Link = typeof link.$inferSelect
export type CreateLink = typeof link.$inferInsert