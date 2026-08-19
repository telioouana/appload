import { z } from "zod";
import { APIError } from "better-auth/api";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ilike, sql } from "drizzle-orm";

import { user } from "@workspace/db/schema";
import type { KycStatus, LoadingBay, OwnershipStatus } from "@workspace/db/types";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { createTRPCRouter, protectedProcedure } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { uniqueViolationConstraint } from "@/lib/db-errors";
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
});

type Db = Parameters<Parameters<typeof protectedProcedure.mutation>[0]>[0]["ctx"]["db"];

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
