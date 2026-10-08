import { sql, type SQL } from "drizzle-orm";
import { pgPolicy, pgRole, type AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * The trust wall: who may read a tenant's rows, decided by Postgres and not
 * by app code alone.
 *
 * The portal connects as the table owner (`postgres`, which Supabase gives
 * `bypassrls`), so nothing here touches it — its tenancy stays the predicate
 * every procedure already writes. The admin connects as `appload_staff`, a
 * plain role with every table granted and row security as the only wall:
 * on the tables below it reads a row only when Appload is a party on it.
 * The Infobip webhook and the admin's crons connect as `appload_service`,
 * which is granted the handful of tables they touch and, on those, every
 * row — a driver's ping is routed to whichever company's load he is on.
 *
 * Both roles are created by `packages/db/scripts/create-db-roles.mjs`, never
 * by a migration (they carry passwords, and roles are cluster-wide while a
 * migration runs per database). `.existing()` keeps drizzle-kit from trying.
 *
 * Every table that names a company or hangs off one of its loads takes a
 * policy from here; a tenant table without one is readable by staff in full,
 * which is exactly the gap this file closes — `verify-trust-wall.ts` lists
 * the tables it expects to find fenced.
 */
export const staffRole = pgRole("appload_staff").existing();
export const serviceRole = pgRole("appload_service").existing();

/** Staff read (and write) the rows `using` admits, nothing else. */
export const staffPolicy = (table: string, using: SQL) =>
    pgPolicy(`${table}_staff_policy`, { for: "all", to: staffRole, using });

/** The service role sees every row of a table it was granted at all. */
export const servicePolicy = (table: string) =>
    pgPolicy(`${table}_service_policy`, { for: "all", to: serviceRole, using: sql`true` });

/**
 * A child row is as visible as its load: the subquery runs as the caller, so
 * `movement`'s own policy decides. No helper function, no recursion — the
 * children never look at each other.
 */
export const throughMovement = (movementId: AnyPgColumn) =>
    sql`exists (select 1 from "movement" m where m."id" = ${movementId})`;

/**
 * The company opened its own books to Appload support (support.ts): a live
 * grant on that company. Only its own rows — a grant by one company never
 * opens another's rows that merely name it as the other party.
 */
export const supportGranted = (organizationId: AnyPgColumn) =>
    sql`exists (select 1 from "support_access_grant" g where g."organization_id" = ${organizationId} and g."revoked_at" is null and g."expires_at" > now())`;

/** A rental line's rows (its days, its questions) are as visible as the line, whose own policy reaches the order's. */
export const throughAllocation = (allocationId: AnyPgColumn) =>
    sql`exists (select 1 from "contract_allocation" a where a."id" = ${allocationId})`;

/** An order's rows (its payments) are as visible as the order. */
export const throughContract = (contractId: AnyPgColumn) =>
    sql`exists (select 1 from "contract" c where c."id" = ${contractId})`;

/** Same rule for the rows of a conversation. */
export const throughThread = (threadId: AnyPgColumn) =>
    sql`exists (select 1 from "thread" t where t."id" = ${threadId})`;
