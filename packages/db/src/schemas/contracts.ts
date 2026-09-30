import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Direct module imports, never the schema barrel: going through it would pull
// in modules that depend on this one and crash at runtime (TDZ). This module
// is imported by movements.ts (the FK below) and must never import it back.
import { driver, truck } from "@workspace/db/fleet";
import { currencyEnum, fiscalRegimeEnum, weightUnitEnum, type Location } from "@workspace/db/orders";
import { staffPolicy } from "@workspace/db/rls";
import type { PriceModel } from "@workspace/db/types";
import { organization, user } from "@workspace/db/users";

/**
 * What a contract commits to, and therefore what its trips draw down:
 * a number of trips, a tonnage, or — a rental — days of a truck.
 */
export const CONTRACT_BASIS = ["trips", "weight", "days"] as const;
export type ContractBasis = (typeof CONTRACT_BASIS)[number];

/**
 * The only states a contract is put in by hand. "Exhausted" (the commitment
 * is used up) and "expired" (its period is over) are read off the trips and
 * the calendar, never written — the same rule as a load's fulfilment.
 */
export const CONTRACT_STATUS = ["draft", "active", "closed"] as const;
export type ContractStatus = (typeof CONTRACT_STATUS)[number];

/**
 * A standing agreement that loads are filed under. A shipper's contract
 * with its transporters, a transporter's with its client, a truck rented
 * out for a month: one parent, split across the companies that execute it
 * (`contract_allocation`), and every trip under it stays a `movement` — the
 * tracking, the papers, the costs and the disputes are untouched.
 *
 * Mirrors the load's two halves: `client_org_id` and `sell_price` are the
 * sell side (what the client pays the owner), each allocation's carrier and
 * `buy_price` the buy side. Either half may be missing — a shipper's own
 * contract has no client, a transporter's own-fleet contract no carrier.
 * One currency per contract; the strip converts at the daily rate.
 *
 * Nothing about fulfilment is stored: `contractProgress` in
 * @workspace/domain/contracts sums the linked trips every time it is asked.
 */
export const contract = pgTable(
    "contract",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        seq: serial("seq").unique().notNull(),
        // Whose books the contract is in
        organizationId: text("organization_id")
            .notNull()
            .references(() => organization.id),
        // "CON-0001-26", numbered per company like a load (organization_counter)
        reference: text("reference"),
        status: text("status", { enum: CONTRACT_STATUS }).default("draft").notNull(),
        basis: text("basis", { enum: CONTRACT_BASIS }).notNull(),

        // Sell side: the client, on the portal or typed, and its own number
        clientOrgId: text("client_org_id").references(() => organization.id),
        clientName: text("client_name"),
        clientReference: text("client_reference"),

        // The lane, when the contract has one; both null means any lane
        origin: jsonb("origin").$type<Location>(),
        destination: jsonb("destination").$type<Location>(),

        startsOn: date("starts_on", { mode: "string" }).notNull(),
        endsOn: date("ends_on", { mode: "string" }).notNull(),

        // Trips, tons or days, by `basis`. Null is an open contract: nobody
        // knows beforehand how much cargo there will be, and trips keep being
        // filed under it while there is some — it is never "used up"
        committedQty: numeric("committed_qty", { precision: 12, scale: 3 }),
        weightUnit: weightUnitEnum("weight_unit"),

        currency: currencyEnum("currency").notNull(),
        fiscalRegime: fiscalRegimeEnum("fiscal_regime"),
        // What the client pays the owner, per trip / ton / day or as one sum;
        // null when the contract has no sell side. Validated by
        // PriceModelSchema on the way in, so a new model is no migration
        sellPrice: jsonb("sell_price").$type<PriceModel>(),

        // The signed paper, one file
        fileUrl: text("file_url"),
        fileName: text("file_name"),

        notes: text("notes"),
        version: integer("version").default(1).notNull(),
        createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        index("contract_organization_status_idx").on(table.organizationId, table.status),
        index("contract_client_idx").on(table.clientOrgId),
        uniqueIndex("contract_reference_uidx")
            .on(table.organizationId, table.reference)
            .where(sql`${table.reference} is not null`),
        check("contract_committed_qty_ck", sql`${table.committedQty} is null or ${table.committedQty} > 0`),
        check("contract_period_ck", sql`${table.endsOn} >= ${table.startsOn}`),
        check("contract_client_ck", sql`${table.clientOrgId} is null or ${table.clientOrgId} <> ${table.organizationId}`),
        // The trust wall (rls.ts): a company's contracts are its most private
        // paper. Staff read one only when Appload owns it or is its client;
        // an allocation naming Appload is readable on its own, below
        staffPolicy("contract", sql`${table.organizationId} = 'appload' or ${table.clientOrgId} = 'appload'`),
    ],
);

export type Contract = typeof contract.$inferSelect;
export type CreateContract = typeof contract.$inferInsert;

/**
 * One company's share of a contract, with the price the owner pays it. A
 * null carrier is the owner's own fleet (one such row per contract). A
 * rental pins the truck (and driver) the days are about; the plate is for a
 * truck that is not on the portal.
 */
export const contractAllocation = pgTable(
    "contract_allocation",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        contractId: text("contract_id")
            .notNull()
            .references(() => contract.id, { onDelete: "cascade" }),
        carrierOrgId: text("carrier_org_id").references(() => organization.id),
        carrierName: text("carrier_name"),
        // Same unit as the contract's basis; null is an open share
        shareQty: numeric("share_qty", { precision: 12, scale: 3 }),
        // What the owner pays this carrier; null on its own fleet
        buyPrice: jsonb("buy_price").$type<PriceModel>(),
        truckId: text("truck_id").references(() => truck.id, { onDelete: "set null" }),
        driverId: text("driver_id").references(() => driver.id, { onDelete: "set null" }),
        truckPlate: text("truck_plate"),
        notes: text("notes"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at")
            .defaultNow()
            .$onUpdate(() => /* @__PURE__ */ new Date())
            .notNull(),
    },
    (table) => [
        uniqueIndex("contract_allocation_carrier_uidx")
            .on(table.contractId, table.carrierOrgId)
            .where(sql`${table.carrierOrgId} is not null`),
        uniqueIndex("contract_allocation_own_fleet_uidx")
            .on(table.contractId)
            .where(sql`${table.carrierOrgId} is null and ${table.carrierName} is null`),
        index("contract_allocation_carrier_idx").on(table.carrierOrgId),
        index("contract_allocation_truck_idx").on(table.truckId).where(sql`${table.truckId} is not null`),
        check("contract_allocation_share_ck", sql`${table.shareQty} is null or ${table.shareQty} > 0`),
        // Own fleet (no carrier, no name) has no buy price; a typed carrier does
        check("contract_allocation_own_fleet_ck", sql`${table.carrierOrgId} is not null or ${table.carrierName} is not null or ${table.buyPrice} is null`),
        // Appload's own share, or a share of a contract staff may already read
        staffPolicy(
            "contract_allocation",
            sql`${table.carrierOrgId} = 'appload' or exists (select 1 from "contract" c where c."id" = ${table.contractId})`,
        ),
    ],
);

export type ContractAllocation = typeof contractAllocation.$inferSelect;
export type CreateContractAllocation = typeof contractAllocation.$inferInsert;
