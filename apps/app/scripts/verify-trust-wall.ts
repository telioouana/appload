/**
 * Proof of the trust wall (packages/db/src/schemas/rls.ts): the admin's
 * database role cannot read a company's loads unless Appload is a party on
 * them, and the webhook's role reaches only the tables it was granted.
 *
 * Three connections to the SHARED DEV DATABASE: the owner (`postgres`, the
 * portal's own, which bypasses row security and writes the fixtures), the
 * staff role (`appload_staff`, what the admin runs on) and the service role
 * (`appload_service`, what the Infobip webhook and the admin crons run on).
 * The fixtures are rows of the portal test carrier (B) that never name
 * Appload, plus one that does; every one of them is deleted at the end,
 * pass or fail.
 *
 * Nothing here goes through a router on purpose: a router adds its own
 * predicates, and the wall has to hold without them.
 *
 * Run from apps/app after `create-db-roles.mjs` has run against dev:
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-trust-wall.ts
 *
 * DATABASE_URL (owner) comes from apps/app/.env; STAFF_DATABASE_URL and
 * SERVICE_DATABASE_URL default to apps/admin/.env's DATABASE_URL and
 * SERVICE_DATABASE_URL — the admin's are exactly the two roles under test.
 */
import fs from "node:fs";

import { eq, inArray, sql } from "drizzle-orm";

import { partnerConnection } from "@workspace/db/connections";
import { createDb, db } from "@workspace/db/db";
import { movement, movementCost, movementDocument, movementRequest } from "@workspace/db/movements";
import { order } from "@workspace/db/orders";
import { thread, threadParticipant } from "@workspace/db/threads";

const appEnv = fs.readFileSync(".env", "utf8");
const adminEnv = fs.readFileSync("../admin/.env", "utf8");
const envValue = (env: string, name: string) => env.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();

process.env.DATABASE_URL ??= envValue(appEnv, "DATABASE_URL");
const STAFF_URL = process.env.STAFF_DATABASE_URL ?? envValue(adminEnv, "DATABASE_URL");
const SERVICE_URL = process.env.SERVICE_DATABASE_URL ?? envValue(adminEnv, "SERVICE_DATABASE_URL");

if (!STAFF_URL?.includes("appload_staff.") || !SERVICE_URL?.includes("appload_service.")) {
    throw new Error("apps/admin/.env must carry the appload_staff DATABASE_URL and the appload_service SERVICE_DATABASE_URL");
}

const staff = createDb(STAFF_URL);
const service = createDb(SERVICE_URL);

// The portal test tenants (memory: portal-test-accounts): B is the carrier whose books are fenced
const A = { org: "42655a3f-0bd5-4e46-af29-9c5ee342a8aa" }; // shipper
const B = { org: "9b7674e5-ea7b-416b-a199-6ca6842da718" }; // carrier
// No third tenant: the rebuilt dev has no Qaqz row, so a "stranger" on a row is simply A again

const origin = { state: "Nampula Province", address: "Nampula, Mozambique", country: "Mozambique", placeId: "ChIJOaE2a7M1xhgRdN3KTEt2F8I" };
const destination = { state: "Gauteng", address: "Johannesburg, South Africa", country: "South Africa", placeId: "ChIJUWpA8GgMlR4RQUDTsdnJiiM" };

/** Every table the wall must fence — a new tenant table belongs here the day it is created. */
const FENCED_TABLES = [
    "movement", "movement_request", "movement_cost", "movement_document", "movement_event",
    "movement_location", "movement_route", "movement_tracking_request", "movement_tracking_alert",
    "movement_dispute", "movement_dispute_row",
    "partner_connection",
    "thread", "thread_participant", "thread_message", "thread_read",
];

const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
    results.push({ name, ok, detail: ok ? undefined : JSON.stringify(detail) });
    console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
}

type Client = typeof db;

/** Rows of `table` with `column = value`, as one connection sees them. */
async function countAs(client: Client, table: string, column: string, value: string): Promise<number> {
    const rows = await client.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} = ${value}`);
    return rows[0]?.n ?? -1;
}

/** What a statement was refused with, or null when it went through. */
async function refusal(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        // drizzle wraps the driver error; Postgres's own words are on the cause
        const wrapped = error as { message?: string; cause?: { message?: string } };
        return wrapped.cause?.message ?? wrapped.message ?? String(error);
    }
}

const movementsHere: string[] = [];
const threadsHere: string[] = [];

async function fixtures() {
    // X: B's own trip for client A — no Appload anywhere on it
    const [x] = await db.insert(movement).values({
        organizationId: B.org, execution: "own-fleet", clientOrgId: A.org, origin, destination, notes: "verify-trust-wall",
    }).returning({ id: movement.id });
    // Y: B handed a load to Appload — Appload is the carrier, staff may see it
    const [y] = await db.insert(movement).values({
        organizationId: B.org, execution: "partner", carrierOrgId: "appload", origin, destination, notes: "verify-trust-wall",
    }).returning({ id: movement.id });
    if (!x || !y) throw new Error("fixture movements not written");
    movementsHere.push(x.id, y.id);

    await db.insert(movementCost).values({ movementId: x.id, organizationId: B.org, kind: "fuel", amount: "100.00", currency: "MZN" });
    await db.insert(movementRequest).values({ movementId: x.id, carrierOrgId: A.org });
    await db.insert(movementDocument).values({ movementId: x.id, type: "other", url: "https://example.invalid/verify-trust-wall.pdf" });

    // A conversation on X, and one on an order that has none yet
    const [tx] = await db.insert(thread).values({ subjectType: "movement", subjectId: x.id }).returning({ id: thread.id });
    const [someOrder] = await db.execute<{ id: string }>(sql`
        select o.id from "order" o
         where not exists (select 1 from thread t where t.subject_type = 'order' and t.subject_id = o.id)
         limit 1`);
    const [to] = someOrder
        ? await db.insert(thread).values({ subjectType: "order", subjectId: someOrder.id }).returning({ id: thread.id })
        : [];
    if (!tx) throw new Error("fixture thread not written");
    threadsHere.push(tx.id, ...(to ? [to.id] : []));
    await db.insert(threadParticipant).values({ threadId: tx.id, organizationId: B.org, staff: false });

    return { x: x.id, y: y.id, tx: tx.id, to: to?.id ?? null };
}

async function main() {
    const { x, y, tx, to } = await fixtures();

    // 0. Every fenced table has row security switched on
    const fenced = await db.execute<{ tablename: string; rowsecurity: boolean }>(sql`
        select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = any(${sql.raw(`array[${FENCED_TABLES.map((name) => `'${name}'`).join(", ")}]`)})`);
    const unfenced = FENCED_TABLES.filter((name) => !fenced.find((row) => row.tablename === name)?.rowsecurity);
    check("row security is on for every fenced table", unfenced.length === 0, unfenced);

    // 1. A load that never names Appload is invisible to staff; one that does is not
    check("owner sees B's load", await countAs(db, "movement", "id", x) === 1);
    check("staff sees zero rows of B's load", await countAs(staff, "movement", "id", x) === 0);
    check("staff sees the load Appload carries", await countAs(staff, "movement", "id", y) === 1);

    // 2. The children follow the load
    for (const table of ["movement_cost", "movement_request", "movement_document"]) {
        check(`owner sees ${table} of B's load`, await countAs(db, table, "movement_id", x) === 1);
        check(`staff sees zero ${table} of B's load`, await countAs(staff, table, "movement_id", x) === 0);
    }

    // 3. The client list and the load's conversation
    const [pairs] = await db.execute<{ n: number }>(sql`select count(*)::int as n from partner_connection`);
    const [staffPairs] = await staff.execute<{ n: number }>(sql`select count(*)::int as n from partner_connection`);
    check("dev has partner connections to hide", (pairs?.n ?? 0) > 0, pairs);
    check("staff sees zero partner connections", staffPairs?.n === 0, staffPairs);
    check("staff sees zero rows of the load's thread", await countAs(staff, "thread", "id", tx) === 0);
    check("staff sees zero participants of the load's thread", await countAs(staff, "thread_participant", "thread_id", tx) === 0);
    if (to) check("staff sees the order's thread", await countAs(staff, "thread", "id", to) === 1);

    // 4. Staff may write a load only with Appload on it (the Appload-link path stays alive)
    const asStranger = await refusal(() => staff.insert(movement).values({
        organizationId: B.org, execution: "partner", carrierOrgId: A.org, origin, destination, notes: "verify-trust-wall",
    }));
    check("staff cannot insert a load between two companies", /row-level security/.test(asStranger ?? ""), asStranger);
    const asAppload = await refusal(async () => {
        const [row] = await staff.insert(movement).values({
            organizationId: B.org, execution: "partner", carrierOrgId: "appload", origin, destination, notes: "verify-trust-wall",
        }).returning({ id: movement.id });
        if (row) movementsHere.push(row.id);
    });
    check("staff inserts a load Appload carries", asAppload === null, asAppload);

    // 5. Staff still reach what the admin is made of
    check("staff reads users", await refusal(() => staff.execute(sql`select 1 from "user" limit 1`)) === null);
    check("staff reads orders", await refusal(() => staff.execute(sql`select 1 from "order" limit 1`)) === null);

    // 6. The service role: every load (to route a driver's ping), and nothing it was not granted
    check("service sees B's load", await countAs(service, "movement", "id", x) === 1);
    const costs = await refusal(() => service.execute(sql`select 1 from movement_cost limit 1`));
    check("service is refused the costs table", /permission denied/.test(costs ?? ""), costs);
    const pairsAsService = await refusal(() => service.execute(sql`select 1 from partner_connection limit 1`));
    check("service is refused the client list", /permission denied/.test(pairsAsService ?? ""), pairsAsService);
}

async function cleanup() {
    if (threadsHere.length > 0) {
        await db.delete(threadParticipant).where(inArray(threadParticipant.threadId, threadsHere));
        await db.delete(thread).where(inArray(thread.id, threadsHere));
    }
    if (movementsHere.length > 0) {
        for (const table of [movementCost, movementRequest, movementDocument]) {
            await db.delete(table).where(inArray(table.movementId, movementsHere));
        }
        await db.delete(movement).where(inArray(movement.id, movementsHere));
    }
    // Leaves nothing of ours behind even when a fixture insert died half-way
    await db.delete(movement).where(eq(movement.notes, "verify-trust-wall"));
    void order;
}

main()
    .catch((error) => {
        console.error(error);
        results.push({ name: "harness ran to the end", ok: false, detail: String(error) });
    })
    .finally(async () => {
        await cleanup();
        const passed = results.filter((row) => row.ok).length;
        console.log(`\n${passed}/${results.length} checks passed`);
        process.exit(passed === results.length ? 0 : 1);
    });
