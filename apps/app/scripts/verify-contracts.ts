/**
 * End-to-end check of the contracts module (`verify-contracts`): drives the
 * portal's contracts and movements routers as the portal test tenants on
 * the SHARED DEV DATABASE — a shipper (A) with its owner, a carrier (B) with
 * its owner and a member. Nobody is signed in; the gates resolve membership
 * live, exactly as behind the HTTP handler.
 *
 * What it proves: a contract is numbered and split into shares; a carrier
 * reads only its own share; a draft takes no trips; a trip filed under a
 * share is priced from it and counts against it the moment it exists, stops
 * counting when cancelled, and a price typed over the default stays; past
 * the share the trip is flagged, never refused; a carrier files its own trip
 * under a client's share and is paid the share's price; a share with trips
 * cannot go; a closed contract takes nothing more; the loads list slices by
 * contract.
 *
 * Every row it writes is deleted at the end, pass or fail.
 *
 * Run from apps/app:
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-contracts.ts
 */
import fs from "node:fs";

import { and, eq, inArray } from "drizzle-orm";

import { activityLog } from "@workspace/db/activity-log";
import { contract, contractAllocation } from "@workspace/db/contracts";
import { db } from "@workspace/db/db";
import {
    movement,
    movementCost,
    movementDocument,
    movementEvent,
    movementLocation,
    movementRequest,
    movementRoute,
    movementTrackingAlert,
    movementTrackingRequest,
} from "@workspace/db/movements";
import { notification } from "@workspace/db/notifications";
import { subscriptionUsage } from "@workspace/db/subscriptions";
import { billableDays, tripPrice } from "@workspace/domain/contracts/price";
import { createCallerFactory } from "@workspace/trpc/init";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";

import { contractsRouter } from "@/frontend/pages/contracts/server/procedures";
import { movementsRouter } from "@/frontend/pages/movements/server/procedures";

process.env.DATABASE_URL ??= fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const SESSION_ID = "verify-contracts";
const createContractsCaller = createCallerFactory(contractsRouter);
const createMovementsCaller = createCallerFactory(movementsRouter);

const contextFor = (userId: string) => ({
    authApi: undefined as never,
    session: { user: { id: userId, name: "harness" }, session: { id: SESSION_ID, userId } } as never,
    db,
    app: "portal" as const,
    headers: new Headers(),
    waitUntil: undefined,
    staffGates: (id: string) => getStaffGates(db, { userId: id }),
    tenantGates: (id: string) => getTenantGates(db, { userId: id }),
});

const contracts = (userId: string) => createContractsCaller(contextFor(userId));
const loads = (userId: string) => createMovementsCaller(contextFor(userId));

const A = { user: "FT7QysKKfs5NKuut5i2S8Nhg6ItrwyuR", org: "42655a3f-0bd5-4e46-af29-9c5ee342a8aa" }; // shipper, owner
const B = { user: "a2R9UNA2NTiEo3FS7DxlwgBFUn8EDNU6", org: "9b7674e5-ea7b-416b-a199-6ca6842da718" }; // carrier, owner
const BM = { user: "AM6u6fxppa9LEkRiMnMDHyrMpThmNrQy", org: B.org }; // carrier, member

const origin = { state: "Nampula Province", address: "Nampula, Mozambique", country: "Mozambique", placeId: "ChIJOaE2a7M1xhgRdN3KTEt2F8I" };
const destination = { state: "Gauteng", address: "Johannesburg, South Africa", country: "South Africa", placeId: "ChIJUWpA8GgMlR4RQUDTsdnJiiM" };
const elsewhere = { state: "Sofala", address: "Beira, Mozambique", country: "Mozambique", placeId: "ChIJ-harness-beira" };

const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);

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

const movementsHere: string[] = [];
const contractsHere: string[] = [];

/** A trip under a share, with the little the form always sends. */
const tripInput = (allocationId: string, extra: Record<string, unknown> = {}) => ({
    execution: "partner" as const,
    origin,
    destination,
    route: "regional" as const,
    weight: 300,
    weightUnit: "ton" as const,
    contractAllocationId: allocationId,
    ...extra,
});

async function main() {
    // 0. The arithmetic the doors price with
    check("per-ton price", tripPrice({ model: "per-ton", rate: 1_500 }, { weight: 300, weightUnit: "ton" }) === 450_000);
    check("lump sum prices a trip at zero", tripPrice({ model: "lump-sum", total: 9 }, { weight: 1, weightUnit: "ton" }) === 0);
    check("working days skip Sundays", billableDays("2026-09-28", "2026-10-04", "working") === 6);

    // 1. A files a tonnage contract and splits it
    const created = await contracts(A.user).create({
        basis: "weight",
        startsOn: iso(-30),
        endsOn: iso(60),
        committedQty: 1000,
        currency: "MZN",
        origin,
        destination,
        notes: "verify-contracts",
    });
    contractsHere.push(created.id);
    check("a contract gets a CON number", /^CON-\d{4}-\d{2}$/.test(created.ref), created.ref);

    const shareB = await contracts(A.user).allocations.add({
        contractId: created.id, carrierOrgId: B.org, shareQty: 600, buyPrice: { model: "per-ton", rate: 1_500 },
    });
    const shareTyped = await contracts(A.user).allocations.add({
        contractId: created.id, carrierName: "Transportes Harness", shareQty: 400, buyPrice: { model: "per-trip", rate: 20_000 },
    });
    check("a second share for the same carrier is refused",
        (await refusal(() => contracts(A.user).allocations.add({ contractId: created.id, carrierOrgId: B.org, shareQty: 1 }))) === "ALLOCATION_EXISTS");
    check("a per-day price cannot price a tonnage",
        (await refusal(() => contracts(A.user).allocations.update({ id: shareTyped.id, carrierName: "Transportes Harness", shareQty: 400, buyPrice: { model: "per-day", rate: 1, billableDays: "calendar" } }))) === "PRICE_MODEL_BASIS_MISMATCH");

    // 2. Who reads what
    const asOwner = await contracts(A.user).get({ id: created.id });
    check("the owner reads both shares", asOwner.allocations.length === 2 && asOwner.role === "owner");
    const asCarrier = await contracts(B.user).get({ id: created.id });
    check("the carrier reads its own share only", asCarrier.allocations.length === 1 && asCarrier.allocations[0]?.id === shareB.id && asCarrier.role === "carrier");
    check("the carrier reads its own price", asCarrier.allocations[0]?.buyPrice?.model === "per-ton");
    const partnersTab = await contracts(B.user).list({ tab: "partners", sort: "newest", dir: "desc", page: 1, pageSize: 25 });
    check("the carrier lists it under From partners", partnersTab.items.some((row) => row.id === created.id));
    check("a member reads it", (await refusal(() => contracts(BM.user).get({ id: created.id }))) === null);
    check("a member cannot create one",
        (await refusal(() => contracts(BM.user).create({ basis: "trips", startsOn: iso(0), endsOn: iso(1), committedQty: 1, currency: "MZN" }))) !== null);

    // 3. A draft takes no trips; an active one prices them
    check("a draft takes no trips", (await refusal(() => loads(A.user).create(tripInput(shareB.id)))) === "CONTRACT_NOT_OPEN");
    const active = await contracts(A.user).transition({ id: created.id, to: "active", expectedVersion: asOwner.version });
    check("activated", active.status === "active");

    const first = await loads(A.user).create(tripInput(shareB.id));
    movementsHere.push(first.id);
    const firstDetail = await loads(A.user).get({ id: first.id });
    check("the trip is priced from the share", firstDetail.money.payable?.total === 450_000, firstDetail.money.payable);
    check("the trip names the partner from the share", firstDetail.carrier?.id === B.org, firstDetail.carrier);
    check("the trip's page knows its contract", firstDetail.contract?.ref === created.ref && firstDetail.contract?.remaining === 300, firstDetail.contract);

    const afterOne = await contracts(A.user).get({ id: created.id });
    const shareBAfterOne = afterOne.allocations.find((row) => row.id === shareB.id);
    check("the share is drawn down the moment the trip exists", shareBAfterOne?.progress.consumed === 300 && shareBAfterOne?.progress.remaining === 300, shareBAfterOne?.progress);
    check("the contract's progress follows", afterOne.progress.consumed === 300 && afterOne.progress.remaining === 700, afterOne.progress);

    // 4. The default is editable, and a cancelled trip stops counting
    const overridden = await loads(A.user).create(tripInput(shareB.id, { buy: { total: 1, currency: "MZN" } }));
    movementsHere.push(overridden.id);
    check("a price typed over the default stays", (await loads(A.user).get({ id: overridden.id })).money.payable?.total === 1);

    const cancelled = await loads(A.user).transition({ id: first.id, to: "cancelled", expectedVersion: firstDetail.version, note: "harness" });
    check("cancelled", cancelled.status === "cancelled");
    const afterCancel = await contracts(A.user).get({ id: created.id });
    check("a cancelled trip stops counting", afterCancel.progress.consumed === 300, afterCancel.progress);

    // 5. Past the share, flagged and filed
    const third = await loads(A.user).create(tripInput(shareB.id));
    movementsHere.push(third.id);
    const exhausted = await contracts(A.user).get({ id: created.id });
    check("the share is used up", exhausted.allocations.find((row) => row.id === shareB.id)?.progress.remaining === 0);
    const fourth = await loads(A.user).create(tripInput(shareB.id, { destination: elsewhere }));
    movementsHere.push(fourth.id);
    const fourthDetail = await loads(A.user).get({ id: fourth.id });
    const flagsOnTrail = fourthDetail.events.flatMap((event) => event.flags ?? []);
    check("over the share is filed and flagged", flagsOnTrail.includes("CONTRACT_OVER_COMMITTED"), flagsOnTrail);
    check("off the lane is filed and flagged", flagsOnTrail.includes("CONTRACT_LANE_MISMATCH"), flagsOnTrail);

    // 6. The carrier files its own trip under the client's share, paid the share's price
    const carrierTrip = await loads(B.user).create({ ...tripInput(shareB.id, { weight: 50 }), execution: "own-fleet" });
    movementsHere.push(carrierTrip.id);
    const carrierDetail = await loads(B.user).get({ id: carrierTrip.id });
    check("the carrier's trip is for the contract's owner", carrierDetail.client?.id === A.org, carrierDetail.client);
    check("the carrier earns the share's price", carrierDetail.money.receivable?.total === 75_000, carrierDetail.money.receivable);
    check("the carrier's shape must match the share",
        (await refusal(() => loads(B.user).create(tripInput(shareB.id)))) === "CONTRACT_SHAPE_MISMATCH");

    // 7. A carrier's own contract with a client, moved by its own fleet
    const own = await contracts(B.user).create({
        basis: "trips",
        clientOrgId: A.org,
        startsOn: iso(-1),
        endsOn: iso(30),
        committedQty: 10,
        currency: "MZN",
        sellPrice: { model: "per-trip", rate: 45_000 },
        notes: "verify-contracts",
    });
    contractsHere.push(own.id);
    const ownFleet = await contracts(B.user).allocations.add({ contractId: own.id, shareQty: 10 });
    check("own fleet takes no buy price",
        (await refusal(() => contracts(B.user).allocations.update({ id: ownFleet.id, shareQty: 10, buyPrice: { model: "per-trip", rate: 1 } }))) === "OWN_FLEET_HAS_NO_BUY_PRICE");
    // Naming a client on the portal makes it a proposal: the client makes it active
    await contracts(A.user).transition({ id: own.id, to: "active", expectedVersion: 1 });
    const ownTrip = await loads(B.user).create({ ...tripInput(ownFleet.id, { weight: 10 }), execution: "own-fleet" });
    movementsHere.push(ownTrip.id);
    const ownTripDetail = await loads(B.user).get({ id: ownTrip.id });
    check("the own-fleet trip is priced for the client", ownTripDetail.money.receivable?.total === 45_000 && ownTripDetail.money.payable === null, ownTripDetail.money);
    const asClient = await contracts(A.user).get({ id: own.id });
    check("the client reads the contract, its price, and no shares", asClient.role === "client" && asClient.sellPrice?.model === "per-trip" && asClient.allocations.length === 0);
    check("the client counts the trips", asClient.progress.consumed === 1, asClient.progress);

    // 7b. An open contract: nobody knows the tonnage beforehand, trips keep coming, nothing runs out
    const open = await contracts(A.user).create({
        basis: "weight",
        startsOn: iso(-5),
        endsOn: iso(90),
        committedQty: null,
        currency: "MZN",
        notes: "verify-contracts",
    });
    contractsHere.push(open.id);
    const openShare = await contracts(A.user).allocations.add({ contractId: open.id, carrierOrgId: B.org, shareQty: null, buyPrice: { model: "per-ton", rate: 1_200 } });
    await contracts(A.user).transition({ id: open.id, to: "active", expectedVersion: 1 });
    for (let i = 0; i < 3; i++) {
        const trip = await loads(A.user).create(tripInput(openShare.id, { weight: 500 }));
        movementsHere.push(trip.id);
    }
    const openDetail = await contracts(A.user).get({ id: open.id });
    check("an open contract has no ceiling", openDetail.committedQty === null && openDetail.progress.remaining === null, openDetail.progress);
    check("an open contract is drawn down and never used up", openDetail.progress.consumed === 1_500 && openDetail.state === "active", openDetail.progress);
    const lastOpen = await loads(A.user).get({ id: movementsHere[movementsHere.length - 1]! });
    check("a trip under an open share is never flagged over-committed", !lastOpen.events.flatMap((event) => event.flags ?? []).includes("CONTRACT_OVER_COMMITTED"));
    check("a trip under an open share is still priced", lastOpen.money.payable?.total === 600_000, lastOpen.money.payable);
    check("an open share reads as open on the load page", lastOpen.contract?.remaining === null, lastOpen.contract);

    // 7c. A proposal: the transporter files a contract naming a client on the portal; the client answers
    const proposal = await contracts(B.user).create({
        basis: "trips",
        clientOrgId: A.org,
        startsOn: iso(0),
        endsOn: iso(60),
        committedQty: null,
        currency: "MZN",
        sellPrice: { model: "per-trip", rate: 40_000 },
        notes: "verify-contracts",
    });
    contractsHere.push(proposal.id);
    const asProposedTo = await contracts(A.user).get({ id: proposal.id });
    check("the client reads the proposal as one", asProposedTo.state === "proposed" && asProposedTo.permissions.canAccept, { state: asProposedTo.state, permissions: asProposedTo.permissions });
    check("the transporter cannot accept for the client",
        (await refusal(() => contracts(B.user).transition({ id: proposal.id, to: "active", expectedVersion: 1 }))) === "CLIENT_MUST_ACCEPT");
    check("the client was told", (await db.select({ id: notification.id }).from(notification).where(and(eq(notification.entityId, proposal.id), eq(notification.kind, "contract.proposed")))).length > 0);
    const accepted = await contracts(A.user).transition({ id: proposal.id, to: "active", expectedVersion: 1 });
    check("the client accepts and the contract is active", accepted.status === "active");
    check("the transporter was told", (await db.select({ id: notification.id }).from(notification).where(and(eq(notification.entityId, proposal.id), eq(notification.kind, "contract.accepted")))).length > 0);
    check("the client does nothing else to it",
        (await refusal(() => contracts(A.user).transition({ id: proposal.id, to: "closed", expectedVersion: accepted.version }))) === "NOT_ALLOWED");
    const declined = await contracts(B.user).create({ basis: "trips", clientOrgId: A.org, startsOn: iso(0), endsOn: iso(10), committedQty: 5, currency: "MZN", notes: "verify-contracts" });
    contractsHere.push(declined.id);
    check("the client declines a proposal", (await contracts(A.user).transition({ id: declined.id, to: "closed", expectedVersion: 1 })).status === "closed");

    // 8. Shares with trips stay; a closed contract takes nothing more
    check("a share with trips cannot go", (await refusal(() => contracts(A.user).allocations.remove({ id: shareB.id }))) === "ALLOCATION_HAS_TRIPS");
    check("a share without trips goes", (await refusal(() => contracts(A.user).allocations.remove({ id: shareTyped.id }))) === null);
    const current = await contracts(A.user).get({ id: created.id });
    const closed = await contracts(A.user).transition({ id: created.id, to: "closed", expectedVersion: current.version });
    check("closed", closed.status === "closed");
    check("a closed contract takes no trips", (await refusal(() => loads(A.user).create(tripInput(shareB.id)))) === "CONTRACT_NOT_OPEN");
    const closedTab = await contracts(A.user).list({ tab: "own", state: "closed", sort: "newest", dir: "desc", page: 1, pageSize: 25 });
    check("the state filter finds it", closedTab.items.some((row) => row.id === created.id && row.state === "closed"));

    // 9. The loads list slices by contract
    const sliced = await loads(A.user).list({ scope: "orders", section: "all", contractId: created.id, sort: "newest", dir: "desc", page: 1, pageSize: 25 });
    // The carrier's own trip under the share names A as its client, so A's list carries it too
    const linked = new Set([first.id, overridden.id, third.id, fourth.id, carrierTrip.id]);
    check("the loads list slices by contract", sliced.items.every((row) => linked.has(row.id)) && sliced.items.length >= 4, sliced.items.map((row) => row.id));
}

async function cleanup() {
    if (movementsHere.length > 0) {
        await db.delete(notification).where(and(eq(notification.entityType, "movement"), inArray(notification.entityId, movementsHere)));
        await db.delete(subscriptionUsage).where(and(eq(subscriptionUsage.entityType, "movement"), inArray(subscriptionUsage.entityId, movementsHere)));
        for (const table of [movementEvent, movementCost, movementDocument, movementRequest, movementLocation, movementTrackingAlert, movementTrackingRequest, movementRoute]) {
            await db.delete(table).where(inArray(table.movementId, movementsHere));
        }
        await db.update(movement).set({ executionMovementId: null }).where(inArray(movement.id, movementsHere));
        await db.delete(movement).where(inArray(movement.id, movementsHere));
    }
    await db.delete(movement).where(inArray(movement.notes, ["verify-contracts"]));
    if (contractsHere.length > 0) {
        await db.delete(contractAllocation).where(inArray(contractAllocation.contractId, contractsHere));
        await db.delete(contract).where(inArray(contract.id, contractsHere));
    }
    await db.delete(notification).where(and(eq(notification.entityType, "contract"), inArray(notification.entityId, contractsHere)));
    await db.delete(contract).where(eq(contract.notes, "verify-contracts"));
    // The CON counters stay where the run left them: a number, once handed out, is
    // never handed out again — a contract filed by hand between two runs keeps its
    await db.delete(activityLog).where(eq(activityLog.sessionId, SESSION_ID));
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
