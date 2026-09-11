import { z } from "zod";
import { APIError } from "better-auth/api";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { driver, truck } from "@workspace/db/fleet";
import { user } from "@workspace/db/users";
import { FLEET_STATUS, KYC_STATUS } from "@workspace/db/types";
import type { KycStatus } from "@workspace/db/types";
import type { db as Database } from "@workspace/db/db";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, tenantProcedure } from "@workspace/trpc/tenant";
import type { OrgAction } from "@workspace/auth/organization-permissions";

import { docProgress, today } from "@workspace/domain/kyc/derive";

import { uniqueViolationConstraint } from "@workspace/db/errors";
import { RegisterDriverBaseSchema } from "@/backend/schemas/register-driver";
// The KYC document reads live with the fleet router: one rule for which
// document rows are current, shared by vehicles and drivers alike
import { currentDocuments, documentsBySubject } from "@/frontend/pages/fleet/server/procedures";
import type { FleetStatus, StatusCounts } from "@/frontend/pages/fleet/types";
import {
    DRIVER_SORTS,
    isPlaceholderEmail,
    ISSUE_STATUSES,
    STATUS_FILTERS,
    type DriverProfile,
    type DriverRow,
    type DriverStats,
    type PagedResult,
    type StatusFilter,
} from "@/frontend/pages/drivers/types";

type Db = typeof Database;

/** A driver as a picker offers it. */
export type DriverOption = {
    id: string;
    name: string;
    phoneNumber: string | null;
    passport: string | null;
    kycStatus: KycStatus;
};

/**
 * Drivers belong to whichever company employs them — a carrier's, or a
 * shipper running its own trucks — so the writes need the `fleet` role
 * statement and nothing about the organization's type, the same as vehicles.
 */
const fleetProcedure = (actions: OrgAction<"fleet">[]) => authorizedTenantProcedure("fleet", actions);

// Escape LIKE wildcards so user input matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const DriversInput = z.object({
    search: z.string().trim().max(120).optional(),
    status: z.enum(STATUS_FILTERS).optional(),
    state: z.enum(FLEET_STATUS).optional(),
    unassigned: z.boolean().optional(),
    sort: z.enum(DRIVER_SORTS).optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).default(25),
    dir: z.enum(["asc", "desc"]).default("asc"),
});

type DriversInput = z.infer<typeof DriversInput>;

/**
 * `email` writes the driver's sign-in address, so it is accepted only while
 * that address is still the `@appload.invalid` stand-in the carrier's own
 * registration put there — see `update`.
 */
const DriverPatch = z.object({
    name: z.string().trim().nonempty().optional(),
    email: z.email().optional(),
    phoneNumber: z.e164().optional(),
    passport: z.string().trim().max(40).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const driversRouter = createTRPCRouter({
    /** One page of the tenant's own drivers. */
    list: tenantProcedure
        .input(DriversInput)
        .query(async ({ ctx, input }): Promise<PagedResult<DriverRow>> => {
            const page = input.page ?? 1;
            const { items, total } = await listDrivers(
                ctx.db,
                ctx.tenant.organizationId,
                input,
                input.pageSize,
                (page - 1) * input.pageSize,
            );

            return { items, total, page, pageSize: input.pageSize };
        }),

    /** The counts behind the status tabs and the attention tiles. */
    stats: tenantProcedure.query(async ({ ctx }): Promise<DriverStats> => {
        const carrier = eq(driver.carrierId, ctx.tenant.organizationId);

        const [row] = await ctx.db
            .select({
                total: count(),
                draft: statusCount(driver.kycStatus, "draft"),
                "pending-review": statusCount(driver.kycStatus, "pending-review"),
                verified: statusCount(driver.kycStatus, "verified"),
                rejected: statusCount(driver.kycStatus, "rejected"),
                expired: statusCount(driver.kycStatus, "expired"),
                suspended: statusCount(driver.kycStatus, "suspended"),
                active: conditionCount(eq(driver.status, "active")),
                idle: conditionCount(eq(driver.status, "idle")),
                free: conditionCount(eq(driver.status, "free")),
                unassigned: conditionCount(isNull(driver.truckId)),
            })
            .from(driver)
            .where(carrier);

        const byStatus = Object.fromEntries(
            KYC_STATUS.map((status) => [status, row?.[status] ?? 0]),
        ) as StatusCounts;

        return {
            total: row?.total ?? 0,
            byStatus,
            issues: ISSUE_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
            byState: {
                active: row?.active ?? 0,
                idle: row?.idle ?? 0,
                free: row?.free ?? 0,
            },
            attention: { unassigned: row?.unassigned ?? 0 },
        };
    }),

    /** Everything the profile panel shows for one driver. */
    get: tenantProcedure
        .input(z.object({ id: z.string().nonempty() }))
        .query(async ({ ctx, input }): Promise<DriverProfile> => {
            const [row] = await ctx.db
                .select({
                    id: driver.id,
                    name: user.name,
                    image: user.image,
                    email: user.email,
                    phoneNumber: user.phoneNumber,
                    passport: driver.passport,
                    status: driver.status,
                    kycStatus: driver.kycStatus,
                    createdAt: driver.createdAt,
                    truckId: driver.truckId,
                    plate: truck.regPlate,
                    truckBrand: truck.brand,
                    truckModel: truck.model,
                })
                .from(driver)
                .innerJoin(user, eq(user.id, driver.userId))
                .leftJoin(truck, eq(truck.id, driver.truckId))
                // The id from input only ever combined with the tenant predicate
                .where(and(eq(driver.id, input.id), eq(driver.carrierId, ctx.tenant.organizationId)));

            if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            const documents = await currentDocuments(ctx.db, "driver", row.id);

            return {
                id: row.id,
                name: row.name,
                image: row.image,
                email: row.email,
                phoneNumber: row.phoneNumber,
                passport: row.passport,
                status: row.status as FleetStatus,
                kycStatus: row.kycStatus,
                progress: docProgress("driver", documents, today()),
                truckId: row.truckId,
                plate: row.plate,
                createdAt: row.createdAt,
                documents: documents.map((doc) => ({
                    type: doc.type,
                    status: doc.status,
                    expiresAt: doc.expiresAt,
                })),
                truck: row.truckId && row.plate
                    ? { id: row.truckId, regPlate: row.plate, brand: row.truckBrand ?? "", model: row.truckModel ?? "" }
                    : null,
            };
        }),

    /** Type-ahead over the tenant's own drivers, by name. */
    search: tenantProcedure
        .input(z.object({ query: z.string() }))
        .query(async ({ ctx, input }): Promise<DriverOption[]> => {
            const trimmed = input.query.trim();

            const filters = [eq(driver.carrierId, ctx.tenant.organizationId)];

            if (trimmed) filters.push(ilike(user.name, `%${escapeLike(trimmed)}%`));

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
     * server-side with a random password (the driver sets their own when the
     * app onboards them); a failed driver insert removes the account again so
     * the two never drift apart — neon-http has no transactions, so the
     * compensation is explicit.
     *
     * Most Mozambican drivers have no email, so one is stood in from the
     * phone number. `@appload.invalid` is a reserved TLD: nothing can ever be
     * delivered to it, and Admin already flags the pattern as a placeholder.
     */
    register: fleetProcedure(["create"])
        .input(RegisterDriverBaseSchema)
        .mutation(async ({ ctx, input }): Promise<DriverOption> => {
            const email = input.email ?? `driver-${input.phoneNumber.replace(/\D/g, "")}@appload.invalid`;

            let userId: string;

            try {
                const created = await ctx.authApi.signUpEmail({
                    body: {
                        email,
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
                        carrierId: ctx.tenant.organizationId,
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
                if (error instanceof TRPCError) throw error;

                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN", cause: error });
            }
        }),

    /**
     * Partial edit of one of the tenant's drivers. Identity fields live on the
     * user account and the passport on the driver row; the two writes run back
     * to back (no transactions), account first, so a failed driver write
     * leaves an account edit that is still correct on its own.
     *
     * Replacing the `@appload.invalid` stand-in with a real address is just an
     * email edit — that is the point of the placeholder. Once a real address
     * is on the account it is off limits: the write goes straight to the
     * `user` row, so Better Auth's change-email confirmation never runs, and
     * pointing the address somewhere else would hand the driver's account —
     * their password reset, their KYC documents, their location history — to
     * whoever asked. A wrong real address is a staff correction, not a
     * carrier one.
     */
    update: fleetProcedure(["update"])
        .input(z.object({ id: z.string().nonempty(), patch: DriverPatch }))
        .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
            const [current] = await ctx.db
                .select({ id: driver.id, userId: driver.userId, email: user.email })
                .from(driver)
                .innerJoin(user, eq(user.id, driver.userId))
                .where(and(eq(driver.id, input.id), eq(driver.carrierId, ctx.tenant.organizationId)));

            if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            const { name, email, phoneNumber, passport } = input.patch;

            const retargeting =
                email !== undefined &&
                email.toLowerCase() !== current.email.toLowerCase() &&
                !isPlaceholderEmail(current.email);

            if (retargeting) {
                throw new TRPCError({ code: "FORBIDDEN", message: "EMAIL_LOCKED" });
            }

            const account: Partial<typeof user.$inferInsert> = {};
            if (name !== undefined) account.name = name;
            if (email !== undefined) account.email = email;
            if (phoneNumber !== undefined) account.phoneNumber = phoneNumber;

            try {
                if (Object.keys(account).length > 0) {
                    await ctx.db.update(user).set(account).where(eq(user.id, current.userId));
                }
                if (passport !== undefined) {
                    await ctx.db
                        .update(driver)
                        .set({ passport: passport || null })
                        .where(and(eq(driver.id, input.id), eq(driver.carrierId, ctx.tenant.organizationId)));
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
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const direction = (dir: "asc" | "desc") => (dir === "desc" ? desc : asc);

const statusCount = (column: AnyColumn, status: KycStatus) =>
    sql<number>`count(*) filter (where ${column} = ${status})`.mapWith(Number);

const conditionCount = (condition: SQL) =>
    sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

function driverConditions(carrierId: string, input: DriversInput): SQL {
    // Always first, and never overridable from input: this is the tenant gate
    const conditions: SQL[] = [eq(driver.carrierId, carrierId)];

    if (input.status) {
        conditions.push(
            input.status === "issues"
                ? inArray(driver.kycStatus, ISSUE_STATUSES)
                : eq(driver.kycStatus, input.status as Exclude<StatusFilter, "issues">),
        );
    }
    if (input.state) conditions.push(eq(driver.status, input.state));
    if (input.unassigned) conditions.push(isNull(driver.truckId));

    if (input.search) {
        const term = `%${escapeLike(input.search)}%`;
        const plate = `%${escapeLike(input.search.toLowerCase().replace(/[^a-z0-9]/g, ""))}%`;

        conditions.push(or(
            ilike(user.name, term),
            ilike(user.phoneNumber, term),
            ilike(driver.passport, term),
            sql`regexp_replace(lower(coalesce(${truck.regPlate}, '')), '[^a-z0-9]', '', 'g') like ${plate}`,
        )!);
    }

    return and(...conditions)!;
}

function driverOrder(input: DriversInput): SQL[] {
    const dir = direction(input.dir);

    switch (input.sort) {
        case "status":
            return [dir(driver.kycStatus), asc(user.name), asc(driver.id)];
        case "created":
            return [dir(driver.createdAt), asc(driver.id)];
        default:
            // Names are not unique; id keeps OFFSET pages stable
            return [dir(user.name), asc(driver.id)];
    }
}

async function listDrivers(db: Db, carrierId: string, input: DriversInput, limit: number, offset: number) {
    const where = driverConditions(carrierId, input);

    const [rows, [total]] = await Promise.all([
        db
            .select({
                id: driver.id,
                name: user.name,
                image: user.image,
                email: user.email,
                phoneNumber: user.phoneNumber,
                passport: driver.passport,
                status: driver.status,
                kycStatus: driver.kycStatus,
                truckId: driver.truckId,
                plate: truck.regPlate,
            })
            .from(driver)
            .innerJoin(user, eq(user.id, driver.userId))
            .leftJoin(truck, eq(truck.id, driver.truckId))
            .where(where)
            .orderBy(...driverOrder(input))
            .limit(limit)
            .offset(offset),

        db
            .select({ value: count() })
            .from(driver)
            .innerJoin(user, eq(user.id, driver.userId))
            .leftJoin(truck, eq(truck.id, driver.truckId))
            .where(where),
    ]);

    const docs = await documentsBySubject(db, "driver", rows.map((row) => row.id));
    const on = today();

    const items: DriverRow[] = rows.map((row) => ({
        ...row,
        status: row.status as FleetStatus,
        progress: docProgress("driver", docs.get(row.id) ?? [], on),
    }));

    return { items, total: total?.value ?? 0 };
}
