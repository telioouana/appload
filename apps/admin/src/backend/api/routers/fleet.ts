import { z } from "zod";
import { APIError } from "better-auth/api";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ilike, sql } from "drizzle-orm";

import { user } from "@workspace/db/schema";
import { LoadingBaySchema, TRUCK_TYPE, type KycStatus, type LoadingBay, type OwnershipStatus } from "@workspace/db/types";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { createTRPCRouter, protectedProcedure } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { uniqueViolationConstraint } from "@workspace/db/errors";
import { RegisterDriverBaseSchema } from "@/backend/schemas/register-driver";
import { RegisterLinkBaseSchema, RegisterTrailerBaseSchema, RegisterTruckBaseSchema, type VehicleKind } from "@/backend/schemas/register-fleet";

export type VehicleOption = {
    id: string;
    regPlate: string;
    year: number | null;
    loadingBay: LoadingBay | null;
    // Surfaced in the picker so an unverified or third-party-owned vehicle
    // is visible at the moment it is chosen, not after the order is booked
    kycStatus: KycStatus;
    ownershipStatus: OwnershipStatus;
};

export type DriverOption = {
    id: string;
    name: string;
    phoneNumber: string | null;
    passport: string | null;
    kycStatus: KycStatus;
};

const vehicleKind = z.enum(["truck", "trailer", "link"]);

const vehicleTable = { truck, trailer, link } as const;

// Escape LIKE wildcards so user input matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

// Plates are stored masked ("AAA 000 MC"); match ignoring case and spacing
// so "aaa000" finds them
const normalizePlateQuery = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizePlate = (value: string) => value.trim().toUpperCase().replace(/\s+/g, " ");

function mapVehicleUniqueViolation(error: unknown): never {
    const constraint = uniqueViolationConstraint(error);

    if (constraint === null) {
        throw error;
    }
    if (constraint.includes("reg_plate")) {
        throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_PLATE" });
    }
    if (constraint.includes("vin")) {
        throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_VIN" });
    }

    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
}

const toOption = (row: {
    id: string; regPlate: string; year: number; loadingBay: LoadingBay | null;
    kycStatus: KycStatus; ownershipStatus: OwnershipStatus;
}): VehicleOption => ({
    id: row.id,
    regPlate: row.regPlate,
    year: row.year,
    loadingBay: row.loadingBay,
    kycStatus: row.kycStatus,
    ownershipStatus: row.ownershipStatus,
});

const DriverPatch = z.object({
    name: z.string().trim().nonempty().optional(),
    email: z.email().optional(),
    phoneNumber: z.e164().nullable().optional(),
    passport: z.string().trim().max(40).nullable().optional(),
    carrierId: z.string().nonempty().optional(),
    truckId: z.string().nonempty().nullable().optional(),
});

// ISO 3779: 17 chars, excludes I, O and Q (same rule as registration)
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

const VehiclePatch = z.object({
    regPlate: z.string().trim().nonempty().optional(),
    internalId: z.string().trim().max(60).nullable().optional(),
    brand: z.string().trim().nonempty().optional(),
    model: z.string().trim().nonempty().optional(),
    year: z.number().int().min(1950).max(2100).optional(),
    vin: z.string().trim().regex(VIN_PATTERN).optional(),
    type: z.enum(TRUCK_TYPE).optional(),
    loadingBay: LoadingBaySchema.nullable().optional(),
    carrierId: z.string().nonempty().optional(),
});

export const fleetRouter = createTRPCRouter({
    /**
     * Type-ahead lookup over the carrier's registered vehicles of one kind.
     * The `year` and `loadingBay` in the result let the order form derive
     * truck age and bay type/capacity on selection.
     */
    searchVehicles: authorizedProcedure("organizations", ["read"])
        .input(z.object({
            kind: vehicleKind,
            carrierId: z.string().nonempty(),
            query: z.string(),
        }))
        .query(async ({ ctx, input }): Promise<VehicleOption[]> => {
            const table = vehicleTable[input.kind];
            const normalized = normalizePlateQuery(input.query);

            const filters = [eq(table.carrierId, input.carrierId)];

            if (normalized) {
                filters.push(
                    sql`replace(lower(${table.regPlate}), ' ', '') LIKE ${`%${escapeLike(normalized)}%`}`,
                );
            }

            const rows = await ctx.db
                .select({
                    id: table.id,
                    regPlate: table.regPlate,
                    year: table.year,
                    loadingBay: table.loadingBay,
                    kycStatus: table.kycStatus,
                    ownershipStatus: table.ownershipStatus,
                })
                .from(table)
                .where(and(...filters))
                .orderBy(asc(table.regPlate))
                .limit(10);

            return rows.map(toOption);
        }),

    registerTruck: authorizedProcedure("organizations", ["create"])
        .input(RegisterTruckBaseSchema.extend({ carrierId: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<VehicleOption> => {
            try {
                const [created] = await ctx.db
                    .insert(truck)
                    .values({
                        carrierId: input.carrierId,
                        regPlate: normalizePlate(input.regPlate),
                        internalId: input.internalId || null,
                        brand: input.brand,
                        model: input.model,
                        year: input.year,
                        type: input.type,
                        // An articulated truck tows the bay on its trailer
                        loadingBay: input.type === "non-articulated" ? (input.loadingBay ?? null) : null,
                        vin: input.vin.toUpperCase(),
                    })
                    .returning({ id: truck.id, regPlate: truck.regPlate, year: truck.year, loadingBay: truck.loadingBay, kycStatus: truck.kycStatus, ownershipStatus: truck.ownershipStatus });

                if (!created) {
                    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                }

                return toOption(created);
            } catch (error) {
                mapVehicleUniqueViolation(error);
            }
        }),

    registerTrailer: authorizedProcedure("organizations", ["create"])
        .input(RegisterTrailerBaseSchema.extend({ carrierId: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<VehicleOption> => {
            return registerTowed(ctx.db, "trailer", input);
        }),

    registerLink: authorizedProcedure("organizations", ["create"])
        .input(RegisterLinkBaseSchema.extend({ carrierId: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<VehicleOption> => {
            return registerTowed(ctx.db, "link", input);
        }),

    /** Type-ahead lookup over the carrier's registered drivers, by name. */
    searchDrivers: authorizedProcedure("organizations", ["read"])
        .input(z.object({
            carrierId: z.string().nonempty(),
            query: z.string(),
        }))
        .query(async ({ ctx, input }): Promise<DriverOption[]> => {
            const trimmed = input.query.trim();

            const filters = [eq(driver.carrierId, input.carrierId)];

            if (trimmed) {
                filters.push(ilike(user.name, `%${escapeLike(trimmed)}%`));
            }

            return ctx.db
                .select({
                    id: driver.id,
                    name: user.name,
                    phoneNumber: user.phoneNumber,
                    passport: driver.passport,
                    kycStatus: driver.kycStatus,
                })
                .from(driver)
                .innerJoin(user, eq(user.id, driver.userId))
                .where(and(...filters))
                .orderBy(asc(user.name))
                .limit(10);
        }),

    /**
     * A driver is a user account plus a driver row. The account is created
     * server-side with a random password (the driver resets it when
     * onboarding to the app); a failed driver insert removes the account
     * again so the two stay consistent.
     */
    registerDriver: authorizedProcedure("organizations", ["create"])
        .input(RegisterDriverBaseSchema.extend({ carrierId: z.string().nonempty() }))
        .mutation(async ({ ctx, input }): Promise<DriverOption> => {
            let userId: string;

            try {
                const created = await ctx.authApi.signUpEmail({
                    body: {
                        email: input.email,
                        // Never shared: the driver signs in via password reset
                        password: crypto.randomUUID(),
                        name: input.name,
                        type: "driver",
                    },
                });

                userId = created.user.id;
            } catch (error) {
                if (error instanceof APIError && error.body?.code === "USER_ALREADY_EXISTS") {
                    throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_EMAIL" });
                }

                throw error;
            }

            try {
                // signUpEmail has no phone field; set it directly
                await ctx.db
                    .update(user)
                    .set({ phoneNumber: input.phoneNumber })
                    .where(eq(user.id, userId));

                const [created] = await ctx.db
                    .insert(driver)
                    .values({
                        userId,
                        carrierId: input.carrierId,
                        passport: input.passport || null,
                    })
                    .returning({ id: driver.id });

                if (!created) {
                    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                }

                return {
                    id: created.id,
                    name: input.name,
                    phoneNumber: input.phoneNumber,
                    passport: input.passport || null,
                    // A freshly registered driver has no paperwork yet
                    kycStatus: "draft",
                };
            } catch (error) {
                // Roll the account back so a retry does not hit DUPLICATE_EMAIL
                await ctx.db.delete(user).where(eq(user.id, userId)).catch(() => undefined);

                const constraint = uniqueViolationConstraint(error);

                if (constraint?.includes("phone")) {
                    throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_PHONE" });
                }
                if (error instanceof TRPCError) {
                    throw error;
                }

                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN", cause: error });
            }
        }),

    /**
     * Partial edit of a driver. Identity fields live on the user account
     * and the rest on the driver row; the two writes run back to back
     * (neon-http has no transactions), account first, so a failed driver
     * write leaves an account edit that is still correct on its own.
     */
    updateDriver: authorizedProcedure("organizations", ["update"])
        .input(z.object({ id: z.string().nonempty(), patch: DriverPatch }))
        .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
            const [current] = await ctx.db
                .select({ id: driver.id, userId: driver.userId, carrierId: driver.carrierId })
                .from(driver)
                .where(eq(driver.id, input.id));

            if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            const { name, email, phoneNumber, ...rest } = input.patch;
            const carrierId = rest.carrierId ?? current.carrierId;

            if (rest.truckId) await assertSameCarrier(ctx.db, rest.truckId, carrierId);

            const account: Partial<typeof user.$inferInsert> = {};
            if (name !== undefined) account.name = name;
            if (email !== undefined) account.email = email;
            if (phoneNumber !== undefined) account.phoneNumber = phoneNumber;

            const row: Partial<typeof driver.$inferInsert> = {};
            if (rest.passport !== undefined) row.passport = rest.passport || null;
            if (rest.truckId !== undefined) row.truckId = rest.truckId;
            if (rest.carrierId !== undefined) {
                row.carrierId = rest.carrierId;
                // A driver moving to another carrier cannot keep the old one's truck
                if (rest.truckId === undefined) row.truckId = null;
            }

            try {
                if (Object.keys(account).length > 0) {
                    await ctx.db.update(user).set(account).where(eq(user.id, current.userId));
                }
                if (Object.keys(row).length > 0) {
                    await ctx.db.update(driver).set(row).where(eq(driver.id, input.id));
                }
            } catch (error) {
                const constraint = uniqueViolationConstraint(error);

                if (constraint === null) throw error;
                if (constraint.includes("email")) throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_EMAIL" });
                if (constraint.includes("phone")) throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_PHONE" });

                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
            }

            return { id: input.id };
        }),

    /** Partial edit of a truck, trailer or link. */
    updateVehicle: authorizedProcedure("organizations", ["update"])
        .input(z.object({ kind: vehicleKind, id: z.string().nonempty(), patch: VehiclePatch }))
        .mutation(async ({ ctx, input }): Promise<{ id: string; regPlate: string }> => {
            const table = vehicleTable[input.kind];
            const { patch } = input;

            // Trailers and links carry the bay themselves; the column is NOT NULL
            if (input.kind !== "truck" && patch.loadingBay === null) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "BAY_REQUIRED" });
            }

            const values: Record<string, unknown> = {};
            if (patch.regPlate !== undefined) values.regPlate = normalizePlate(patch.regPlate);
            if (patch.internalId !== undefined) values.internalId = patch.internalId || null;
            if (patch.brand !== undefined) values.brand = patch.brand;
            if (patch.model !== undefined) values.model = patch.model;
            if (patch.year !== undefined) values.year = patch.year;
            if (patch.vin !== undefined) values.vin = patch.vin.toUpperCase();
            if (patch.loadingBay !== undefined) values.loadingBay = patch.loadingBay;
            if (patch.carrierId !== undefined) values.carrierId = patch.carrierId;
            if (input.kind === "truck" && patch.type !== undefined) {
                values.type = patch.type;
                // An articulated truck tows the bay on its trailer
                if (patch.type === "articulated") values.loadingBay = null;
            }

            if (Object.keys(values).length === 0) {
                const [row] = await ctx.db.select({ id: table.id, regPlate: table.regPlate }).from(table).where(eq(table.id, input.id));
                if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
                return row;
            }

            try {
                const [updated] = await ctx.db
                    .update(table)
                    .set(values)
                    .where(eq(table.id, input.id))
                    .returning({ id: table.id, regPlate: table.regPlate });

                if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

                return updated;
            } catch (error) {
                mapVehicleUniqueViolation(error);
            }
        }),

    /** Sets, moves or clears a driver's home truck. */
    assignDriver: authorizedProcedure("organizations", ["update"])
        .input(z.object({ driverId: z.string().nonempty(), truckId: z.string().nonempty().nullable() }))
        .mutation(async ({ ctx, input }): Promise<{ id: string; truckId: string | null }> => {
            const [current] = await ctx.db
                .select({ id: driver.id, carrierId: driver.carrierId })
                .from(driver)
                .where(eq(driver.id, input.driverId));

            if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
            if (input.truckId) await assertSameCarrier(ctx.db, input.truckId, current.carrierId);

            await ctx.db.update(driver).set({ truckId: input.truckId }).where(eq(driver.id, input.driverId));

            return { id: input.driverId, truckId: input.truckId };
        }),
});

type Db = Parameters<Parameters<typeof protectedProcedure.mutation>[0]>[0]["ctx"]["db"];

/** A driver may only be put on a truck of their own carrier. */
async function assertSameCarrier(db: Db, truckId: string, carrierId: string) {
    const [home] = await db.select({ carrierId: truck.carrierId }).from(truck).where(eq(truck.id, truckId));

    if (!home) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
    if (home.carrierId !== carrierId) throw new TRPCError({ code: "CONFLICT", message: "TRUCK_OTHER_CARRIER" });
}

type TowedInput = z.infer<typeof RegisterTrailerBaseSchema> & { carrierId: string };

async function registerTowed(db: Db, kind: Exclude<VehicleKind, "truck">, input: TowedInput): Promise<VehicleOption> {
    const table = vehicleTable[kind];

    try {
        const [created] = await db
            .insert(table)
            .values({
                carrierId: input.carrierId,
                regPlate: normalizePlate(input.regPlate),
                internalId: input.internalId || null,
                brand: input.brand,
                model: input.model,
                year: input.year,
                loadingBay: input.loadingBay,
                vin: input.vin.toUpperCase(),
            })
            .returning({ id: table.id, regPlate: table.regPlate, year: table.year, loadingBay: table.loadingBay, kycStatus: table.kycStatus, ownershipStatus: table.ownershipStatus });

        if (!created) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
        }

        return toOption(created);
    } catch (error) {
        mapVehicleUniqueViolation(error);
    }
}
