/**
 * End-to-end check of rentals (`verify-rentals`): drives the portal's
 * rentals, movements and fleet routers as the portal test tenants on the
 * SHARED DEV DATABASE — a carrier (B) renting two trucks to a shipper (A),
 * and the shipper renting one of its own trucks to itself.
 *
 * What it proves: the billing arithmetic; a rental is numbered and proposed
 * like any order and the client accepts it; the whole period is billed
 * unless a day is marked, a stopped day drops out, a standby day bills at
 * its rate; a day outside the period is refused; the client disputes a day
 * and the provider settles it; a payment moves the money on both sides; a
 * line that ends early stops billing; a line with a log cannot be removed;
 * a truck on a rental refuses a second overlapping rental and flags a load;
 * the fleet shows the badge; the driver's Sim/Não and silence are filed.
 *
 * Every row it writes is deleted at the end, pass or fail.
 *
 * Run from apps/app:
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-rentals.ts
 */
import fs from "node:fs";

import { and, eq, inArray } from "drizzle-orm";

import { activityLog } from "@workspace/db/activity-log";
import { contract, contractAllocation } from "@workspace/db/contracts";
import { db } from "@workspace/db/db";
import { truck } from "@workspace/db/fleet";
import { movement, movementEvent } from "@workspace/db/movements";
import { notification } from "@workspace/db/notifications";
import { contractPayment, rentalCheckinRequest, rentalDay } from "@workspace/db/rentals";
import { subscriptionUsage } from "@workspace/db/subscriptions";
import { lineBilling, lineDays, periodDays } from "@workspace/domain/rentals/billing";
import { recordRentalAnswer, silentLines } from "@workspace/domain/rentals/checkin";
import { todayInMaputo } from "@workspace/domain/contracts/price";
import { createCallerFactory } from "@workspace/trpc/init";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";

import { appRouter } from "@/backend/api/routers/_app";

process.env.DATABASE_URL ??= fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const SESSION_ID = "verify-rentals";
const createCaller = createCallerFactory(appRouter);
const logged: Promise<unknown>[] = [];

const as = (userId: string) => createCaller({
    authApi: undefined as never,
    session: { user: { id: userId, name: "harness" }, session: { id: SESSION_ID, userId } } as never,
    db,
    app: "portal" as const,
    headers: new Headers(),
    waitUntil: (promise: Promise<unknown>) => { logged.push(promise); },
    staffGates: (id: string) => getStaffGates(db, { userId: id }),
    tenantGates: (id: string) => getTenantGates(db, { userId: id }),
});

const A = { user: "FT7QysKKfs5NKuut5i2S8Nhg6ItrwyuR", org: "42655a3f-0bd5-4e46-af29-9c5ee342a8aa" }; // shipper, owner
const B = { user: "a2R9UNA2NTiEo3FS7DxlwgBFUn8EDNU6", org: "9b7674e5-ea7b-416b-a199-6ca6842da718" }; // carrier, owner

const site = { state: "Tete Province", address: "Moatize, Mozambique", country: "Mozambique", placeId: "ChIJ-harness-moatize" };
const origin = { state: "Nampula Province", address: "Nampula, Mozambique", country: "Mozambique", placeId: "ChIJOaE2a7M1xhgRdN3KTEt2F8I" };
const destination = { state: "Gauteng", address: "Johannesburg, South Africa", country: "South Africa", placeId: "ChIJUWpA8GgMlR4RQUDTsdnJiiM" };

const DAY = 86_400_000;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);

const contractsHere: string[] = [];
const movementsHere: string[] = [];
const trucksHere: string[] = [];
const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
    results.push({ name, ok, detail: ok ? undefined : JSON.stringify(detail) });
    console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
}

async function refusal(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return (error as { message?: string }).message ?? String(error);
    }
}

async function main() {
    const today = todayInMaputo();
    const rate = { model: "per-day" as const, rate: 25_000, billableDays: "working" as const, standbyRate: 12_000 };

    // 0. The arithmetic on its own
    const days = lineDays({ startsOn: "2026-09-28", orderEndsOn: "2026-10-31", lineEndsOn: null, mode: "working", today: "2026-10-10", log: [
        { day: "2026-09-30", state: "stopped", disputedAt: null, driverAnswer: "no" },
        { day: "2026-10-02", state: "standby", disputedAt: null, driverAnswer: null },
    ] });
    check("the whole period is billed unless marked", lineBilling(days, rate).amount === 10 * 25_000 + 12_000, lineBilling(days, rate));
    check("working days skip Sundays", periodDays("2026-09-28", "2026-10-04", "working").length === 6);

    // 1. B rents two trucks to A: a proposal A accepts, numbered like any order
    const startsOn = isoDaysAgo(9);
    const created = await as(B.user).rentals.create({
        clientOrgId: A.org,
        site,
        startsOn,
        endsOn: null,
        currency: "MZN",
        sellPrice: rate,
        notes: "verify-rentals",
        lines: [
            { truckPlate: "HRN-R1" },
            { truckPlate: "HRN-R2" },
        ],
    });
    contractsHere.push(created.id);
    check("a rental gets an ORD number", /^ORD-\d{4}-\d{2}$/.test(created.ref), created.ref);

    const proposed = await as(A.user).rentals.get({ id: created.id });
    check("the client reads it as a proposal with two trucks and no buy prices", proposed.state === "proposed" && proposed.lines.length === 2 && proposed.lines.every((line) => line.buyPrice === null), { state: proposed.state, lines: proposed.lines.length });
    check("…and may accept it", proposed.permissions.canAccept);
    const accepted = await as(A.user).rentals.transition({ id: created.id, to: "active", expectedVersion: proposed.version });
    check("the client accepts and it runs", accepted.status === "active");

    // 2. The whole period is billed unless marked
    const expectedDays = periodDays(startsOn, today, "working").length;
    let asOwner = await as(B.user).rentals.get({ id: created.id });
    const line1 = asOwner.lines[0]!;
    const line2 = asOwner.lines[1]!;
    check("every working day so far is billed, on both trucks", line1.billing.billableDays === expectedDays && line2.billing.billableDays === expectedDays && line1.billing.amount === expectedDays * 25_000, { expectedDays, line1: line1.billing });
    check("the money follows", asOwner.money!.lines[0]?.billable === 2 * expectedDays * 25_000 && asOwner.money!.lines[0]?.projected === null, asOwner.money!.lines[0]);
    check("the list shows the period open", asOwner.endsOn === null && asOwner.periodDays === null);

    // The first working day of the period, and a day that is a Sunday is never asked for
    const workingDays = periodDays(startsOn, today, "working");
    const firstDay = workingDays[0]!;
    const secondDay = workingDays[1]!;
    await as(B.user).rentals.days.mark({ allocationId: line1.id, day: firstDay, state: "stopped", note: "avaria" });
    await as(B.user).rentals.days.mark({ allocationId: line1.id, day: secondDay, state: "standby" });
    asOwner = await as(B.user).rentals.get({ id: created.id });
    const marked = asOwner.lines.find((line) => line.id === line1.id)!;
    check("a stopped day drops out and a standby day bills at its rate", marked.billing.stopped === 1 && marked.billing.standby === 1 && marked.billing.amount === (expectedDays - 2) * 25_000 + 12_000, marked.billing);
    check("a future day is refused", (await refusal(() => as(B.user).rentals.days.mark({ allocationId: line1.id, day: isoDaysAgo(-1), state: "off" }))) === "DAY_IN_FUTURE");
    check("a day before the period is refused", (await refusal(() => as(B.user).rentals.days.mark({ allocationId: line1.id, day: isoDaysAgo(20), state: "off" }))) === "DAY_OUT_OF_PERIOD");
    check("the client cannot mark a day", (await refusal(() => as(A.user).rentals.days.mark({ allocationId: line1.id, day: firstDay, state: "off" }))) === "NOT_THE_PROVIDER");

    // 3. The client disputes a day; the provider settles it
    await as(A.user).rentals.days.dispute({ allocationId: line2.id, day: firstDay, note: "não apareceu" });
    let asClient = await as(A.user).rentals.get({ id: created.id });
    const disputed = asClient.lines.find((line) => line.id === line2.id)!;
    check("a disputed day is still billed and marked on both sides", disputed.disputedDays === 1 && disputed.days.find((day) => day.day === firstDay)?.billable === true
        && (await as(B.user).rentals.get({ id: created.id })).lines.find((line) => line.id === line2.id)?.disputedDays === 1, disputed.days.find((day) => day.day === firstDay));
    check("the provider cannot dispute", (await refusal(() => as(B.user).rentals.days.dispute({ allocationId: line2.id, day: secondDay }))) === "NOT_THE_CLIENT");
    await as(B.user).rentals.days.settle({ allocationId: line2.id, day: firstDay, resolution: "accept" });
    asClient = await as(A.user).rentals.get({ id: created.id });
    const settled = asClient.lines.find((line) => line.id === line2.id)!;
    check("accepted, the day no longer counts and the dispute is off", settled.disputedDays === 0 && settled.days.find((day) => day.day === firstDay)?.state === "off", settled.days.find((day) => day.day === firstDay));

    // 4. Money moves on both sides
    await as(B.user).rentals.payments.record({ contractId: created.id, leg: "sell", amount: 100_000, currency: "MZN", paidAt: new Date(), reference: "TRF 1" });
    asOwner = await as(B.user).rentals.get({ id: created.id });
    asClient = await as(A.user).rentals.get({ id: created.id });
    const ownerBillable = asOwner.lines.reduce((sum, line) => sum + line.billing.amount!, 0);
    check("the owner reads what came in and what is still owed", asOwner.money!.lines[0]?.received === 100_000 && asOwner.money!.lines[0]?.receivable === ownerBillable - 100_000, asOwner.money!.lines[0]);
    check("the client reads the same from its side", asClient.money!.lines[0]?.received === 100_000 && asClient.money!.lines[0]?.billable === ownerBillable && asClient.payments.length === 1, asClient.money!.lines[0]);
    check("the client cannot record a payment", (await refusal(() => as(A.user).rentals.payments.record({ contractId: created.id, leg: "sell", amount: 1, currency: "MZN", paidAt: new Date() }))) === "NOT_FOUND");
    check("a correction needs a reference", (await refusal(() => as(B.user).rentals.payments.record({ contractId: created.id, leg: "sell", amount: -1, currency: "MZN", paidAt: new Date() }))) === "CORRECTION_NEEDS_REFERENCE");

    // 5. A line that ends early stops billing; a line with a log cannot be removed
    await as(B.user).rentals.lines.end({ id: line2.id, endsOn: secondDay });
    asOwner = await as(B.user).rentals.get({ id: created.id });
    const ended = asOwner.lines.find((line) => line.id === line2.id)!;
    check("a truck that left bills only to its last day", ended.endsOn === secondDay && ended.days.length === 2, { endsOn: ended.endsOn, days: ended.days.length });
    check("a line with days on its log cannot be removed", (await refusal(() => as(B.user).rentals.lines.remove({ id: line1.id }))) === "LINE_HAS_LOG");

    // 6. The driver's morning answer, filed through the webhook's door
    await db.insert(rentalCheckinRequest).values({ allocationId: line1.id, day: today, attempt: 1, channel: "whatsapp", status: "sent", scheduledFor: new Date() });
    await db.insert(rentalCheckinRequest).values({ allocationId: line2.id, day: today, attempt: 1, channel: "whatsapp", status: "sent", scheduledFor: new Date() });
    check("a forged answer files nothing", (await recordRentalAnswer(db, { payload: `rental-no:${created.id}:${today}`, conversationId: null })) === false);
    check("the driver's Não makes an off day", (await recordRentalAnswer(db, { payload: `rental-no:${line1.id}:${today}`, conversationId: null })) === true
        && (await db.select().from(rentalDay).where(and(eq(rentalDay.allocationId, line1.id), eq(rentalDay.day, today))))[0]?.state === "off");
    check("…and a silent truck reads as silent", (await silentLines(db, [line1.id, line2.id], today)).has(line2.id) && !(await silentLines(db, [line1.id, line2.id], today)).has(line1.id));
    asOwner = await as(B.user).rentals.get({ id: created.id });
    check("the page says who answered what today", asOwner.lines.find((line) => line.id === line1.id)?.today.answer === "no" && asOwner.lines.find((line) => line.id === line2.id)?.today.silent === true, asOwner.lines.map((line) => line.today));
    await as(B.user).rentals.days.mark({ allocationId: line1.id, day: today, state: "worked", note: "chegou às 10h" });
    const corrected = (await db.select().from(rentalDay).where(and(eq(rentalDay.allocationId, line1.id), eq(rentalDay.day, today))))[0];
    check("the transporter corrects the day and the answer stays on record", corrected?.state === "worked" && corrected.driverAnswer === "no", corrected);

    // 7. A truck can be on one rental at a time, and a load on it is flagged
    // A truck of A's own, written for the run: dev has no fleet rows for the test tenants
    const [aTruck] = await db.insert(truck).values({
        carrierId: A.org, regPlate: "HRN 900 MC", brand: "Harness", model: "Rental", year: 2024, type: "articulated", vin: `HRN-RENTAL-${Date.now()}`,
    }).returning({ id: truck.id });
    trucksHere.push(aTruck!.id);
    if (aTruck) {
        const own = await as(A.user).rentals.create({
            site: null, startsOn: isoDaysAgo(2), endsOn: isoDaysAgo(-20), currency: "MZN", sellPrice: null, notes: "verify-rentals",
            lines: [{ truckId: aTruck.id }],
        });
        contractsHere.push(own.id);
        const ownDetail = await as(A.user).rentals.get({ id: own.id });
        await as(A.user).rentals.transition({ id: own.id, to: "active", expectedVersion: ownDetail.version });
        check("the same truck refuses a second overlapping rental", (await refusal(() => as(A.user).rentals.create({
            site: null, startsOn: isoDaysAgo(1), endsOn: null, currency: "MZN", sellPrice: null, notes: "verify-rentals", lines: [{ truckId: aTruck.id }],
        }))) === "TRUCK_ON_RENTAL");
        const load = await as(A.user).movements.create({ execution: "own-fleet", origin, destination, route: "regional", truckId: aTruck.id, cargoDescription: "verify-rentals" } as never);
        movementsHere.push(load.id);
        const filed = await as(A.user).movements.get({ id: load.id });
        check("a load on a rented truck is filed and flagged", filed.events.flatMap((event) => event.flags ?? []).includes("TRUCK_ON_RENTAL"), filed.events.flatMap((event) => event.flags ?? []));
        const profile = await as(A.user).fleet.vehicles.get({ kind: "truck", id: aTruck.id });
        check("the fleet shows the truck on rental", profile.rental?.contractId === own.id && profile.rental.until === isoDaysAgo(-20), profile.rental);
        await as(A.user).rentals.transition({ id: own.id, to: "closed", expectedVersion: ownDetail.version + 1 });
        check("…and not once it is closed", (await as(A.user).fleet.vehicles.get({ kind: "truck", id: aTruck.id })).rental === null);
    } else {
        check("A has a truck on dev for the overlap checks", false, "no truck");
    }

    // 8. The rental never shows as a multi-trip order
    const multi = await as(B.user).contracts.list({ tab: "own", sort: "newest", dir: "desc", page: 1, pageSize: 100 });
    check("the multi-trip list leaves rentals out", !multi.items.some((row) => row.id === created.id));
    const rentals = await as(B.user).rentals.list({ tab: "own", sort: "newest", dir: "desc", page: 1, pageSize: 25 });
    check("the rentals list carries it with its trucks", rentals.items.some((row) => row.id === created.id && row.trucks.length === 2), rentals.items.find((row) => row.id === created.id));
}

async function cleanup() {
    await Promise.all(logged).catch(() => undefined);
    if (movementsHere.length > 0) {
        await db.delete(notification).where(and(eq(notification.entityType, "movement"), inArray(notification.entityId, movementsHere)));
        await db.delete(subscriptionUsage).where(and(eq(subscriptionUsage.entityType, "movement"), inArray(subscriptionUsage.entityId, movementsHere)));
        await db.delete(movementEvent).where(inArray(movementEvent.movementId, movementsHere));
        await db.delete(movement).where(inArray(movement.id, movementsHere));
    }
    await db.delete(movement).where(eq(movement.cargoDescription, "verify-rentals"));
    if (contractsHere.length > 0) {
        const lines = await db.select({ id: contractAllocation.id }).from(contractAllocation).where(inArray(contractAllocation.contractId, contractsHere));
        const lineIds = lines.map((line) => line.id);
        if (lineIds.length > 0) {
            await db.delete(rentalDay).where(inArray(rentalDay.allocationId, lineIds));
            await db.delete(rentalCheckinRequest).where(inArray(rentalCheckinRequest.allocationId, lineIds));
        }
        await db.delete(contractPayment).where(inArray(contractPayment.contractId, contractsHere));
        await db.delete(notification).where(and(eq(notification.entityType, "contract"), inArray(notification.entityId, contractsHere)));
        await db.delete(contractAllocation).where(inArray(contractAllocation.contractId, contractsHere));
        await db.delete(contract).where(inArray(contract.id, contractsHere));
    }
    await db.delete(contract).where(eq(contract.notes, "verify-rentals"));
    if (trucksHere.length > 0) await db.delete(truck).where(inArray(truck.id, trucksHere));
    await db.delete(activityLog).where(eq(activityLog.sessionId, SESSION_ID));
}

main()
    .catch((error) => {
        console.error(error);
        results.push({ name: "harness ran to the end", ok: false, detail: String(error) });
    })
    .finally(async () => {
        await cleanup();
        const failed = results.filter((row) => !row.ok);
        console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
        process.exit(failed.length === 0 ? 0 : 1);
    });
