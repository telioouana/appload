/**
 * End-to-end check of the shipment conversations (design §7, `verify-threads`):
 * drives the portal's threads router as three real companies on the SHARED DEV
 * DATABASE — the portal test tenants (a shipper, a carrier with an owner and a
 * member, and a stranger) — and the admin's threads router as a real Appload
 * staff account, each with an explicit context. Nobody is signed in; the gates
 * still resolve membership and staff type live, exactly as they do behind the
 * HTTP handler.
 *
 * Two fixtures: an Appload order walked from prospect to booked through the
 * real request/quote/accept flow, and a subcontracted load offered to a partner
 * that accepted it, so the executor has a linked row of its own. Every boundary
 * the design names is then asked of the routers: who may read before and after
 * booking, whose unread count moves, what an attachment URL must look like, who
 * is told, and what a withdrawn offer or a changed carrier takes away.
 *
 * Every row it writes is deleted at the end, pass or fail, and counted on the
 * way out.
 *
 * Run from apps/app (the react-server condition turns `server-only` into the
 * no-op it is inside a server render; tsx is not a dependency):
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-threads.ts
 */
import fs from "node:fs";

import { and, eq, inArray, like } from "drizzle-orm";

import { activityLog } from "@workspace/db/activity-log";
import { db } from "@workspace/db/db";
import { movement, movementEvent } from "@workspace/db/movements";
import { notification } from "@workspace/db/notifications";
import { order, orderHistory, orderOffer, sheetSync } from "@workspace/db/orders";
import { orderRequest } from "@workspace/db/quotes";
import { thread, threadMessage, threadParticipant, threadRead } from "@workspace/db/threads";
import { rateLimit } from "@workspace/db/users";

import type { StaffActor } from "@workspace/domain/orders/actor";
import { getThread } from "@workspace/domain/threads/queries";

import { createCallerFactory } from "@workspace/trpc/init";
import { getStaffGates } from "@workspace/trpc/staff-gate";
import { getTenantGates } from "@workspace/trpc/tenant-gate";

import { movementsRouter } from "@/frontend/pages/movements/server/procedures";
import { ordersRouter } from "@/frontend/pages/orders/server/procedures";
import { threadsRouter } from "@/frontend/pages/threads/server/procedures";

// The admin app's own door, imported by path: the file only depends on
// @workspace/* packages, so it resolves from here exactly as it does in its
// own app. Driving it is what proves ops reach an order thread through the
// staff gate rather than through a tenant one.
import { threadsRouter as adminThreadsRouter } from "../../admin/src/backend/api/routers/threads";

process.env.DATABASE_URL ??= fs.readFileSync("../admin/.env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const SESSION_ID = "verify-threads";

const createThreadsCaller = createCallerFactory(threadsRouter);
const createOrdersCaller = createCallerFactory(ordersRouter);
const createMovementsCaller = createCallerFactory(movementsRouter);
const createAdminThreadsCaller = createCallerFactory(adminThreadsRouter);

const contextFor = (userId: string, app: "portal" | "admin") => ({
    authApi: undefined as never,
    session: { user: { id: userId, name: "harness" }, session: { id: SESSION_ID, userId } } as never,
    db,
    app,
    headers: new Headers(),
    waitUntil: undefined,
    staffGates: (id: string) => getStaffGates(db, { userId: id }),
    tenantGates: (id: string) => getTenantGates(db, { userId: id }),
});

/** The portal's three doors, as one member of one company. */
const chatAs = (userId: string) => createThreadsCaller(contextFor(userId, "portal"));
const ordersAs = (userId: string) => createOrdersCaller(contextFor(userId, "portal"));
const loadsAs = (userId: string) => createMovementsCaller(contextFor(userId, "portal"));
/** Appload ops, through the admin app. */
const opsAs = (userId: string) => createAdminThreadsCaller(contextFor(userId, "admin"));

const A = { user: "FT7QysKKfs5NKuut5i2S8Nhg6ItrwyuR", org: "42655a3f-0bd5-4e46-af29-9c5ee342a8aa" }; // shipper, owner
const B = { user: "a2R9UNA2NTiEo3FS7DxlwgBFUn8EDNU6", org: "9b7674e5-ea7b-416b-a199-6ca6842da718" }; // carrier, owner
const BM = { user: "AM6u6fxppa9LEkRiMnMDHyrMpThmNrQy", org: B.org }; // carrier, member
const C = { user: "kU9US5NBPjNtS5HsSQBW3ZfEZvj7GQSm", org: "49db92eb-c131-467e-8bfc-fe42a7dcc149" }; // stranger
const OPS = "AAPyvwSmq3eqQV3LhURiooVNhTlTIyoX"; // Appload staff, platform role "admin"

const staffActor: StaffActor = { kind: "staff", userId: OPS, role: "admin" };

const origin = { state: "Nampula Province", address: "Nampula, Mozambique", country: "Mozambique", placeId: "ChIJOaE2a7M1xhgRdN3KTEt2F8I" };
const destination = { state: "Gauteng", address: "Johannesburg, South Africa", country: "South Africa", placeId: "ChIJUWpA8GgMlR4RQUDTsdnJiiM" };

const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
    results.push({ name, ok, detail: ok ? undefined : JSON.stringify(detail) });
    console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
}

async function expectError(name: string, run: () => Promise<unknown>, message: string) {
    try {
        await run();
        check(name, false, "no error thrown");
    } catch (error) {
        const got = (error as { message?: string }).message;
        check(name, got === message, { expected: message, got });
    }
}

/** What refused a call that should have gone through, or null when nothing did. */
async function refusal(run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return (error as { message?: string }).message ?? String(error);
    }
}

/** Every row the harness wrote, by the key its table is cleaned up on. */
const ordersHere: string[] = [];
const orderRefsHere: string[] = [];
const loadsHere: string[] = [];

/**
 * EdgeStore's public URL for a file uploaded into one thread's folder.
 *
 * Nothing loads `.env` under tsx, so `threads/send.ts` captured the defaults
 * it falls back to — the same host, and no project pinned. The real project
 * is read off the file anyway so the URL is the shape the bucket actually
 * mints and passes either way; what these checks turn on is the
 * `/threads/<id>/` folder, which is pinned in both configurations.
 */
const PROJECT_ID = fs.readFileSync(".env", "utf8").match(/^EDGE_STORE_PROJECT_ID=(.+)$/m)?.[1]?.trim() ?? "project";

const attachmentUrl = (threadId: string, name: string) =>
    `https://files.edgestore.dev/${PROJECT_ID}/threadFiles/_public/threads/${threadId}/${name}`;

/**
 * Takes the harness's orders back out of the Google Sheets outbox.
 *
 * Filing and booking an order marks it pending for the sheet, and the retry
 * cron sweeps that every half hour: a row pushed for an order this run is
 * about to delete would be left behind in the logbook with nothing behind it.
 * Called as soon as the fixture stops moving, and again on the way out.
 */
async function clearSheetOutbox(): Promise<number> {
    if (ordersHere.length === 0) return 0;

    const cleared = await db
        .delete(sheetSync)
        .where(inArray(sheetSync.orderId, ordersHere))
        .returning({ orderId: sheetSync.orderId });

    return cleared.length;
}

/** The thread.message rows written for one message, by recipient. */
async function noticesFor(messageId: string) {
    return db
        .select({ organizationId: notification.organizationId, userId: notification.userId, params: notification.params })
        .from(notification)
        .where(eq(notification.dedupeKey, `thread-message:${messageId}`));
}

/** The sides `ensureThread` has cached for a thread — the count's entry point. */
const participantsOf = (threadId: string) =>
    db
        .select({ organizationId: threadParticipant.organizationId, staff: threadParticipant.staff })
        .from(threadParticipant)
        .where(eq(threadParticipant.threadId, threadId));

/** What one member has waiting on one thread, counted by the badge query. */
async function badge(userId: string, threadId: string): Promise<number> {
    const { byThread } = await chatAs(userId).unread();

    return byThread.find((row) => row.threadId === threadId)?.count ?? 0;
}

/**
 * A prospect filed by A and quoted by B, through the real portal doors: the
 * request is what makes B a candidate, and the quote is what A can later
 * accept to book it.
 */
async function fileOrder(description: string): Promise<{ orderId: string; offerId: string }> {
    const a = ordersAs(A.user);

    const { orderId } = await a.create({
        loadingAddress: origin,
        offloadingAddress: destination,
        expectedLoadingDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        distance: 2400,
        routeType: "regional",
        category: "agriculture-products",
        description,
        weight: 30,
        weightUnit: "ton",
        loadType: "dedicated",
    });

    orderRefsHere.push(orderId);
    const [row] = await db.select({ id: order.id }).from(order).where(eq(order.orderId, orderId)).limit(1);
    ordersHere.push(row!.id);

    await a.sendRequests({ orderId, carrierOrgIds: [B.org], message: "HARNESS please quote" });

    const quote = await ordersAs(B.user).offers.create({
        orderId,
        values: { fiscalRegime: "normal", total: 75000, currency: "MZN", includesGit: false, includesGps: false },
    });

    // The fixture's own request/quote/booking mails are not what this checks,
    // and the outbox sweep runs every five minutes on dev: taken out of the
    // queue as soon as they are written, on the harness's own rows only
    await db
        .update(notification)
        .set({ emailState: "none" })
        .where(and(eq(notification.entityType, "order"), eq(notification.entityId, orderId), eq(notification.emailState, "pending")));

    return { orderId, offerId: quote.id };
}

/**
 * A's load placed with B, offered and accepted — the only way an executing
 * partner gets a linked row of its own (verify-movements' `ownTrip`). Returns
 * the owner's row and the executor's.
 */
async function placeLoad(cargoDescription: string, accept: boolean): Promise<{ owner: string; executor: string | null; executorRef: string | null }> {
    const a = loadsAs(A.user);

    const owned = await a.create({
        execution: "partner",
        carrierOrgId: B.org,
        origin,
        destination,
        cargoDescription,
        buy: { total: 1000, currency: "MZN" },
    });
    loadsHere.push(owned.id);

    const placed = await a.get({ id: owned.id });
    const offered = await a.offer({ id: owned.id, expectedVersion: placed.version });

    if (!accept) return { owner: owned.id, executor: null, executorRef: null };

    const accepted = await loadsAs(B.user).respond({ id: owned.id, expectedVersion: offered.version, decision: "accept" });
    loadsHere.push(accepted.id);

    return { owner: owned.id, executor: accepted.id, executorRef: accepted.ref };
}

async function orderThread() {
    console.log("\n— an order thread, before and after it is booked");

    const { orderId, offerId } = await fileOrder("HARNESS maize, 30t");
    const subject = { subjectType: "order" as const, subjectId: orderId };

    const opened = await chatAs(A.user).get(subject);
    check("A opens the thread of its own prospect", Boolean(opened.threadId), opened);
    check("…with itself and Appload in the room, and no carrier",
        opened.participants.length === 2
        && opened.participants.some((party) => party.organizationId === A.org)
        && opened.participants.some((party) => party.staff),
        opened.participants);

    const first = await chatAs(A.user).send({ ...subject, body: "HARNESS is anyone there?", attachments: [] });
    check("A writes into it before booking", first.threadId === opened.threadId, first);

    await expectError("the carrier it asked for a quote cannot read it", () => chatAs(B.user).get(subject), "THREAD_NOT_FOUND");
    await expectError("…nor page its messages", () => chatAs(B.user).messages(subject), "THREAD_NOT_FOUND");
    await expectError("…nor write into it", () =>
        chatAs(B.user).send({ ...subject, body: "HARNESS quoting", attachments: [] }), "THREAD_NOT_FOUND");
    await expectError("a company with nothing to do with it is refused the same way",
        () => chatAs(C.user).get(subject), "THREAD_NOT_FOUND");

    const opsView = await opsAs(OPS).get(subject);
    check("Appload ops read the order thread", opsView.threadId === opened.threadId, opsView);
    const opsMessages = await opsAs(OPS).messages(subject);
    check("…and see what the client wrote", opsMessages.some((message) => message.id === first.id), opsMessages.map((message) => message.body));

    console.log("\n— A books B");
    const [beforeBooking] = await db.select({ version: order.version }).from(order).where(eq(order.orderId, orderId)).limit(1);
    await ordersAs(A.user).offers.accept({ orderId, offerId, expectedVersion: beforeBooking!.version });
    await clearSheetOutbox();

    const carrierView = await chatAs(B.user).get(subject);
    check("the booked carrier lands in the same conversation", carrierView.threadId === opened.threadId, carrierView);
    const carrierMessages = await chatAs(B.user).messages(subject);
    check("…and reads what was said before it joined", carrierMessages.some((message) => message.id === first.id), carrierMessages.map((message) => message.body));
    check("…with three sides in the room now",
        carrierView.participants.length === 3 && carrierView.participants.some((party) => party.organizationId === B.org),
        carrierView.participants);

    console.log("\n— per person, not per company");
    check("B's owner has the client's message waiting", carrierView.unread === 1, carrierView.unread);
    const memberView = await chatAs(BM.user).get(subject);
    check("…and so does B's colleague, on their own count", memberView.unread === 1, memberView.unread);

    const reply = await chatAs(B.user).send({ ...subject, body: "HARNESS we are on it", attachments: [] });
    check("the sender's own count is clear", (await chatAs(B.user).get(subject)).unread === 0, await badge(B.user, opened.threadId));
    check("…while their colleague now has two", (await chatAs(BM.user).get(subject)).unread === 2, await badge(BM.user, opened.threadId));
    check("…and the client one", await badge(A.user, opened.threadId) === 1, await badge(A.user, opened.threadId));

    await chatAs(A.user).markRead(subject);
    check("reading it clears the client's badge", await badge(A.user, opened.threadId) === 0, await badge(A.user, opened.threadId));
    check("…and nobody else's", await badge(BM.user, opened.threadId) === 2, await badge(BM.user, opened.threadId));

    console.log("\n— one notification per message per recipient member, and none for the sender");
    const told = await noticesFor(reply.id);
    check("B writing tells the other side's members",
        told.length > 0 && told.every((notice) => notice.organizationId === A.org), told.map((notice) => [notice.organizationId, notice.userId]));
    check("…one row each, nobody twice",
        told.length === new Set(told.map((notice) => notice.userId)).size && told.length > 0, told.length);
    check("…and nobody on the sending side is told",
        !told.some((notice) => notice.organizationId === B.org), told.map((notice) => notice.organizationId));
    check("…carrying the order it is about", told.every((notice) => (notice.params as { reference?: string }).reference === orderId), told[0]?.params);

    console.log("\n— attachments live under the thread they are posted to");
    const strayThread = crypto.randomUUID();
    await expectError("a file uploaded against another thread is refused", () =>
        chatAs(B.user).send({
            ...subject,
            body: "",
            attachments: [{ url: attachmentUrl(strayThread, "pod.pdf"), name: "pod.pdf", size: 1024, mimeType: "application/pdf" }],
        }), "INVALID_ATTACHMENT_URL");
    await expectError("…and so is one served from somewhere else entirely", () =>
        chatAs(B.user).send({
            ...subject,
            body: "",
            attachments: [{ url: `https://files.example.com/_public/threads/${opened.threadId}/pod.pdf`, name: "pod.pdf", size: 1024, mimeType: "application/pdf" }],
        }), "INVALID_ATTACHMENT_URL");

    const withFile = await chatAs(B.user).send({
        ...subject,
        body: "",
        attachments: [{ url: attachmentUrl(opened.threadId, "pod.pdf"), name: "HARNESS pod.pdf", size: 2048, mimeType: "application/pdf" }],
    });
    const [stored] = await chatAs(B.user).messages({ ...subject, limit: 1 });
    check("a file in this thread's own folder is stored with what it is",
        stored?.id === withFile.id
        && stored?.attachments.length === 1
        && stored?.attachments[0]?.name === "HARNESS pod.pdf"
        && stored?.attachments[0]?.size === 2048
        && stored?.attachments[0]?.mimeType === "application/pdf",
        stored?.attachments);

    console.log("\n— the rate limit is a runaway client's, not a conversation's");
    const [counter] = await db
        .select({ count: rateLimit.count })
        .from(rateLimit)
        .where(eq(rateLimit.id, `thread-send:user:${B.user}`))
        .limit(1);
    check("B's few sends are nowhere near the hour's 60", (counter?.count ?? 0) < 60 && (counter?.count ?? 0) > 0, counter);
    const stillAllowed = await refusal(() => chatAs(B.user).send({ ...subject, body: "HARNESS one more", attachments: [] }));
    check("…and the next one goes through", stillAllowed === null, stillAllowed);

    return { orderId, threadId: opened.threadId, subject };
}

/**
 * A booking undone is a side lost: the previous carrier stops reading the
 * conversation and stops counting it, without anything being migrated.
 */
async function rebooked(context: Awaited<ReturnType<typeof orderThread>>) {
    console.log("\n— the carrier changes");

    const { orderId, threadId, subject } = context;
    check("B has messages waiting before the change", await badge(BM.user, threadId) > 0, await badge(BM.user, threadId));

    // C stands in for the carrier the order is re-booked with: the thread's
    // sides come from the order row, never from the company's type
    await db.update(order).set({ carrierId: C.org, carrierName: "HARNESS Replacement Lda" }).where(eq(order.orderId, orderId));

    // The participant cache converges when a party next opens the thread
    await chatAs(A.user).get(subject);

    const sides = await participantsOf(threadId);
    check("the previous carrier is no longer a side", !sides.some((side) => side.organizationId === B.org), sides);
    check("…and the new one is", sides.some((side) => side.organizationId === C.org), sides);

    await expectError("B can no longer open it", () => chatAs(B.user).get(subject), "THREAD_NOT_FOUND");
    check("…and it has left B's badge", await badge(BM.user, threadId) === 0, await badge(BM.user, threadId));

    const replacement = await chatAs(C.user).get(subject);
    check("the new carrier reads the whole conversation", replacement.threadId === threadId, replacement);
}

async function loadThread() {
    console.log("\n— a subcontracted load: one conversation, two rows");

    const { owner, executor, executorRef } = await placeLoad("HARNESS subcontracted, 30t", true);
    const ownerSubject = { subjectType: "movement" as const, subjectId: owner };
    const executorSubject = { subjectType: "movement" as const, subjectId: executor! };

    const ownerView = await chatAs(A.user).get(ownerSubject);
    check("the owner opens its load's thread", Boolean(ownerView.threadId), ownerView);
    check("…with the two companies in the room and Appload out of it",
        ownerView.participants.length === 2 && !ownerView.participants.some((party) => party.staff),
        ownerView.participants);

    const executorView = await chatAs(B.user).get(executorSubject);
    check("the executor opens its OWN row and lands in the owner's thread", executorView.threadId === ownerView.threadId, executorView);
    check("…normalized to the row that names both companies, so there is only one",
        executorView.subject.subjectId === owner && ownerView.subject.subjectId === owner,
        { owner: ownerView.subject, executor: executorView.subject });

    const said = await chatAs(A.user).send({ ...ownerSubject, body: "HARNESS loading Monday", attachments: [] });
    const heard = await chatAs(B.user).messages(executorSubject);
    check("what the owner writes is what the executor reads", heard.some((message) => message.id === said.id), heard.map((message) => message.body));

    const notices = await db
        .select({ organizationId: notification.organizationId, entityId: notification.entityId, params: notification.params })
        .from(notification)
        .where(eq(notification.dedupeKey, `thread-message:${said.id}`));
    check("only the executor is told",
        notices.length > 0 && notices.every((notice) => notice.organizationId === B.org),
        notices.map((notice) => notice.organizationId));
    check("…on its own row, by the reference its lists hold",
        notices.every((notice) => notice.entityId === executor
            && (notice.params as { reference?: string }).reference === executorRef),
        { notices: notices.map((notice) => [notice.entityId, notice.params]), executor, executorRef });

    console.log("\n— a tenant's books are its own");
    await expectError("Appload ops cannot read a portal load's thread", () =>
        getThread(db, staffActor, ownerSubject), "THREAD_NOT_FOUND");
    const opsInput = await refusal(() => opsAs(OPS).get({ subjectType: "movement", subjectId: owner } as never));
    check("…and the admin door does not even take the subject", opsInput !== null, opsInput);

    console.log("\n— the client the load is for is not a party to it");
    await db.update(movement).set({ clientOrgId: C.org }).where(eq(movement.id, owner));
    await expectError("the client on the row is refused", () => chatAs(C.user).get(ownerSubject), "THREAD_NOT_FOUND");

    return { owner, executor: executor! };
}

async function withdrawnOffer() {
    console.log("\n— an offer withdrawn takes the conversation with it");

    const { owner } = await placeLoad("HARNESS withdrawn offer", false);
    const subject = { subjectType: "movement" as const, subjectId: owner };

    const invited = await chatAs(B.user).get(subject);
    check("the partner being offered the load can talk to the owner", Boolean(invited.threadId), invited);

    const offered = await loadsAs(A.user).get({ id: owner });
    await loadsAs(A.user).withdraw({ id: owner, expectedVersion: offered.version });

    await expectError("once the offer is withdrawn it cannot read the thread", () => chatAs(B.user).get(subject), "THREAD_NOT_FOUND");
    await expectError("…nor write into it", () =>
        chatAs(B.user).send({ ...subject, body: "HARNESS still here?", attachments: [] }), "THREAD_NOT_FOUND");

    // The cache converges the next time a party looks, exactly as on the order
    await chatAs(A.user).get(subject);
    const sides = await participantsOf(invited.threadId);
    check("…and it is no longer a side of the thread", !sides.some((side) => side.organizationId === B.org), sides);
}

/**
 * Everything the run wrote, deleted in the order the foreign keys allow, and
 * counted so the console says what went. Threads take their participants,
 * reads and messages with them (cascade); order history does not (restrict).
 */
async function cleanup() {
    const counts: Record<string, number> = {};
    const subjectIds = [...orderRefsHere, ...loadsHere];

    if (subjectIds.length > 0) {
        const threads = await db
            .select({ id: thread.id })
            .from(thread)
            .where(inArray(thread.subjectId, subjectIds));
        const threadIds = threads.map((row) => row.id);

        if (threadIds.length > 0) {
            counts.thread_message = (await db.delete(threadMessage).where(inArray(threadMessage.threadId, threadIds)).returning({ id: threadMessage.id })).length;
            counts.thread_read = (await db.delete(threadRead).where(inArray(threadRead.threadId, threadIds)).returning({ userId: threadRead.userId })).length;
            counts.thread_participant = (await db.delete(threadParticipant).where(inArray(threadParticipant.threadId, threadIds)).returning({ id: threadParticipant.id })).length;
            counts.thread = (await db.delete(thread).where(inArray(thread.id, threadIds)).returning({ id: thread.id })).length;
        }

        counts.notification = (await db.delete(notification).where(inArray(notification.entityId, subjectIds)).returning({ id: notification.id })).length;
    }

    // The loads an Appload order opens in the portal companies' own books —
    // the client's row and the carriers' — go before the orders do: the link
    // is a plain FK that nulls itself, so an order deleted first leaves them
    // behind with nothing pointing at them
    const linked = ordersHere.length === 0 ? [] : (await db
        .select({ id: movement.id })
        .from(movement)
        .where(inArray(movement.orderId, ordersHere)))
        .map((row) => row.id);

    if (linked.length > 0) {
        counts.linked_event = (await db.delete(movementEvent).where(inArray(movementEvent.movementId, linked)).returning({ id: movementEvent.id })).length;
        counts.linked_movement = (await db.delete(movement).where(inArray(movement.id, linked)).returning({ id: movement.id })).length;
    }

    if (ordersHere.length > 0) {
        counts.sheet_sync = await clearSheetOutbox();
        counts.order_history =(await db.delete(orderHistory).where(inArray(orderHistory.orderId, ordersHere)).returning({ id: orderHistory.id })).length;
        counts.order_offer = (await db.delete(orderOffer).where(inArray(orderOffer.orderId, ordersHere)).returning({ id: orderOffer.id })).length;
        counts.order_request = (await db.delete(orderRequest).where(inArray(orderRequest.orderId, ordersHere)).returning({ id: orderRequest.id })).length;
        counts.order = (await db.delete(order).where(inArray(order.id, ordersHere)).returning({ id: order.id })).length;
    }

    if (loadsHere.length > 0) {
        // The trail is restrict, and the two rows of a subcontract point at
        // each other: events first, then the seam, then the loads
        counts.movement_event = (await db.delete(movementEvent).where(inArray(movementEvent.movementId, loadsHere)).returning({ id: movementEvent.id })).length;
        await db.update(movement).set({ executionMovementId: null }).where(inArray(movement.id, loadsHere));
        counts.movement = (await db.delete(movement).where(inArray(movement.id, loadsHere)).returning({ id: movement.id })).length;
    }

    counts.activity_log = (await db.delete(activityLog).where(eq(activityLog.sessionId, SESSION_ID)).returning({ id: activityLog.id })).length;
    // The send counters this run raised, and only those
    counts.rate_limit = (await db
        .delete(rateLimit)
        .where(and(like(rateLimit.id, "thread-send:user:%"), inArray(rateLimit.id, [A.user, B.user, BM.user, C.user].map((id) => `thread-send:user:${id}`))))
        .returning({ id: rateLimit.id })).length;

    console.log(`\ncleaned up ${Object.entries(counts).filter(([, value]) => value > 0).map(([table, value]) => `${value} ${table}`).join(", ") || "nothing"}`);

    // Counted again by id, since by now there is no order left to find them by
    const left = linked.length === 0
        ? []
        : await db.select({ id: movement.id }).from(movement).where(inArray(movement.id, linked));

    console.log(`linked loads left behind: ${left.length}`);
}

orderThread()
    .then(async (context) => {
        await rebooked(context);
    })
    .then(loadThread)
    .then(withdrawnOffer)
    .catch((error) => {
        console.error("\nharness crashed:", error);
        results.push({ name: "harness ran to the end", ok: false, detail: String(error) });
    })
    .finally(async () => {
        await cleanup().catch((error) => console.error("cleanup failed:", error));
        const failed = results.filter((result) => !result.ok);
        console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
        process.exit(failed.length === 0 ? 0 : 1);
    });
