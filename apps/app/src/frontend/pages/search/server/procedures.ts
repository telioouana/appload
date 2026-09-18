import "server-only";

import { z } from "zod";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { partnerConnection } from "@workspace/db/connections";
import { driver, link, trailer, truck } from "@workspace/db/fleet";
import { movement } from "@workspace/db/movements";
import { isPartnerOrgType } from "@workspace/db/types";
import { organization, user } from "@workspace/db/users";

import { movementRole } from "@workspace/domain/movements/policy";

import { createTRPCRouter } from "@workspace/trpc/init";
import { tenantProcedure } from "@workspace/trpc/tenant";

import type { VehicleKind } from "@/frontend/pages/fleet/types";
import { sectionPredicate, toMovementRow, type PingState } from "@/frontend/pages/movements/server/projection";
import type { GlobalSearch, SearchLoad, SearchPartner, SearchVehicle } from "@/frontend/pages/search/types";

// Escape LIKE wildcards so what the user typed matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/** A palette shows the best few matches of each kind, not a list. */
const HITS = 5;

const VEHICLE_TABLE = { truck, trailer, link } as const;

/**
 * The loads the company's own Orders and Trips pages list: its own rows, the
 * ones a partner moves for it, and the offers waiting on its answer (which
 * Trips lists with its own).
 *
 * `visibleMovements` is the wider gate — it also holds the counterpart row of
 * every linked load, which is how the client can read the trip its partner
 * runs — but searching it would answer one load twice, once from each side.
 * The two lists' predicates are the same rows the lists de-duplicate to, and
 * each is a strict subset of `visibleMovements`, so nothing is widened.
 */
const searchableLoads = (tenantId: string): SQL =>
    or(
        sectionPredicate("orders", "all", tenantId),
        sectionPredicate("trips", "all", tenantId),
    ) as SQL;

/**
 * What a load is looked up by: its reference, its driver, its plate, its
 * cargo and the two companies named on it.
 *
 * The party names are matched on the owner's own rows alone. They are the
 * owner's business — the row projection hands `client` and `carrier` to
 * nobody else — and a search that matched a column the caller cannot read
 * would give it away one character at a time, by whether the row comes back.
 */
function loadMatches(term: string, tenantId: string): SQL {
    const pattern = `%${escapeLike(term)}%`;

    return or(
        // Both names a load answers to: the order it is, and the request it
        // was filed as. "ORD-0001" and "0001-26" each find it
        ilike(movement.reference, pattern),
        ilike(movement.requestReference, pattern),
        ilike(movement.driverName, pattern),
        ilike(movement.truckPlate, pattern),
        ilike(movement.cargoDescription, pattern),
        and(
            eq(movement.organizationId, tenantId),
            or(ilike(movement.clientName, pattern), ilike(movement.carrierName, pattern)),
        ),
    ) as SQL;
}

/**
 * The palette names a load and nothing more, so the projection's context is
 * empty: no company names to resolve, no pings to show. It is run all the
 * same because it is the one place a movement column becomes a response —
 * what it is here for is the money it leaves out.
 */
const NO_PINGS: PingState = { last: new Map(), counts: new Map() };

export const searchRouter = createTRPCRouter({
    /**
     * The ⌘K palette: a load, a partner, a driver or a plate from any page.
     * Small queries in parallel, every one of them scoped to the caller's own
     * company — the palette reaches across the portal, never across tenants.
     */
    global: tenantProcedure
        .input(z.object({ query: z.string().trim().min(2).max(80) }))
        .query(async ({ ctx, input }): Promise<GlobalSearch> => {
            const tenantId = ctx.tenant.organizationId;
            const term = input.query;
            const pattern = `%${escapeLike(term)}%`;
            // Plates are stored masked ("AAA 000 MC"); match ignoring case
            // and spacing so "aaa000" finds them
            const compact = term.toLowerCase().replace(/[^a-z0-9]/g, "");
            const plate = `%${escapeLike(compact)}%`;

            const vehicleHits = (kind: VehicleKind) => {
                const table = VEHICLE_TABLE[kind];

                // Nothing left to match on — "--" or an accented-only term
                // folds away, and a bare "%%" would list the yard
                if (compact === "") return Promise.resolve<SearchVehicle[]>([]);

                return ctx.db
                    .select({ id: table.id, plate: table.regPlate })
                    .from(table)
                    .where(and(
                        eq(table.carrierId, tenantId),
                        sql`regexp_replace(lower(${table.regPlate}), '[^a-z0-9]', '', 'g') like ${plate}`,
                    ))
                    .orderBy(asc(table.regPlate))
                    .limit(HITS)
                    .then((rows): SearchVehicle[] => rows.map((row) => ({ ...row, kind })));
            };

            const [rows, partners, drivers, trucks, trailers, links] = await Promise.all([
                ctx.db
                    .select()
                    .from(movement)
                    .where(and(searchableLoads(tenantId), loadMatches(term, tenantId)))
                    .orderBy(desc(movement.createdAt))
                    .limit(HITS),

                // The join pins the tenant as one side of the pair and reads
                // the other, so no further tenant predicate is needed
                ctx.db
                    .select({ id: partnerConnection.id, name: organization.name, type: organization.type })
                    .from(partnerConnection)
                    .innerJoin(organization, or(
                        and(eq(partnerConnection.requesterOrgId, tenantId), eq(organization.id, partnerConnection.targetOrgId)),
                        and(eq(partnerConnection.targetOrgId, tenantId), eq(organization.id, partnerConnection.requesterOrgId)),
                    ))
                    .where(and(eq(partnerConnection.status, "accepted"), ilike(organization.name, pattern)))
                    .orderBy(asc(organization.name))
                    .limit(HITS),

                ctx.db
                    .select({ id: driver.id, name: user.name, phone: user.phoneNumber })
                    .from(driver)
                    .innerJoin(user, eq(user.id, driver.userId))
                    .where(and(
                        eq(driver.carrierId, tenantId),
                        or(ilike(user.name, pattern), ilike(user.phoneNumber, pattern)),
                    ))
                    .orderBy(asc(user.name))
                    .limit(HITS),

                vehicleHits("truck"),
                vehicleHits("trailer"),
                vehicleHits("link"),
            ]);

            const loads = rows.flatMap((row): SearchLoad[] => {
                const role = movementRole(row, tenantId);

                // The predicates only return rows the caller is a side of; a
                // row with no role here would be a bug in them
                if (!role) return [];

                // A palette hit is the load under its own name; the Appload
                // order it may follow is not one of the fields carried here,
                // so the row is projected without the id map that resolves it
                const { id, ref, status, execution, origin, destination } =
                    toMovementRow(row, role, { names: new Map(), pings: NO_PINGS, trailId: row.id });

                return [{ id, ref, status, execution, role, origin, destination }];
            });

            return {
                loads,
                // Appload's own row is on the platform but is nobody's
                // partner; the column admits it, an accepted connection does not
                partners: partners.filter((row): row is SearchPartner => isPartnerOrgType(row.type)),
                drivers,
                vehicles: [...trucks, ...trailers, ...links].slice(0, HITS),
            };
        }),
});
