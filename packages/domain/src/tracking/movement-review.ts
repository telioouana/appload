import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";

import { chatConversation, type TrackingSlot, type TrackingStatus } from "@workspace/db/chats";
import type { db as Database } from "@workspace/db/db";
import {
    movement,
    movementLocation,
    movementTrackingAlert,
    movementTrackingRequest,
    type Movement,
    type TrackingAlertIssue,
} from "@workspace/db/movements";
import { member } from "@workspace/db/users";
import { haversineMeters } from "@workspace/maps/lib/geometry";

import { movementRef } from "@workspace/domain/movements/refs";
import { TRACKED_STATUSES } from "@workspace/domain/movements/status";
import { notify } from "@workspace/domain/notifications";
import {
    ATTEMPT_GAP_MINUTES,
    BATCH_SIZE,
    decideNextAttempt,
    slotStart,
    type SlotInfo,
} from "@workspace/domain/tracking/slot";

/**
 * What a slot's tracking was actually worth, once the window has closed.
 *
 * Asking twice a day is only half the job: a driver who never answers, one who
 * answers from the same lay-by he was in this morning, and one who picks a
 * town off his phone's list instead of sharing where the truck is all leave a
 * tenant believing its load is being followed. This is the half that says so,
 * and it is deliberately separate from the sending half — the runner decides
 * what to ask, this decides what the answers were worth.
 *
 * Who hears about it escalates rather than fans out: the first bad slot is the
 * transporter's own business, and only a second one in a row reaches the
 * client, because a client told about every missed ping stops reading them.
 */

/**
 * How far into the window the review runs. The window is 110 minutes long and
 * QStash ticks every 15, so this covers its last ticks — by then all three
 * attempts have been made and the driver has had the whole slot to answer.
 */
export const REVIEW_AFTER_MINUTES = 90;

/** Under this much ground covered since the last position, a truck on route did not move. */
export const SHORT_DISTANCE_METERS = 20_000;

/**
 * The request statuses that prove the driver was actually reached. A request
 * still "pending", or one that failed to leave the building, is our problem
 * and not the driver's, and alerting on it would train the tenant to ignore
 * the alert. "responded" has to count too, and is the whole reason the list is
 * not just sent/delivered: any real reply closes every open request on the
 * thread (respondMovementRequests), so the driver who answered with a chosen
 * address — or with words and no position at all — leaves no sent row behind
 * to be judged on.
 */
const REACHED: TrackingStatus[] = ["sent", "delivered", "responded"];

/**
 * The slot before this one: the morning follows the previous day's afternoon,
 * the afternoon follows the same day's morning. What `streak` is counted over.
 */
function previousSlot(info: SlotInfo): { slotDate: string; slot: TrackingSlot } {
    if (info.slot === "afternoon") {
        return { slotDate: info.slotDate, slot: "morning" };
    }

    const day = new Date(Date.parse(`${info.slotDate}T00:00:00Z`) - 24 * 3_600_000);

    return { slotDate: day.toISOString().slice(0, 10), slot: "afternoon" };
}

/**
 * Reviews one closed slot over every movement it asked a driver for, and
 * raises Claire's alert on the ones that came back empty, barely moved, or
 * came back as a chosen address.
 *
 * Idempotent through the notification's own (user, dedupeKey) index: every one
 * of the window's last ticks runs this, and only the first of them writes
 * anybody an alert. Returns how many movements were judged and how many
 * alerts that produced.
 */
export async function reviewMovementSlot(
    db: typeof Database,
    info: SlotInfo,
): Promise<{ reviewed: number; alerts: number }> {
    const start = slotStart(info);
    const now = new Date();

    // Every request this slot wrote, whatever became of it — the decision
    // table is read from these exactly as the runner reads it, so a slot is
    // judged only once nothing more is owed the driver
    const requests = await db
        .select({
            movementId: movementTrackingRequest.movementId,
            conversationId: movementTrackingRequest.conversationId,
            attempt: movementTrackingRequest.attempt,
            status: movementTrackingRequest.status,
            createdAt: movementTrackingRequest.createdAt,
        })
        .from(movementTrackingRequest)
        .where(and(
            eq(movementTrackingRequest.slotDate, info.slotDate),
            eq(movementTrackingRequest.slot, info.slot),
        ));

    const byMovement = new Map<string, typeof requests>();
    for (const row of requests) {
        const list = byMovement.get(row.movementId);
        if (list) list.push(row); else byMovement.set(row.movementId, [row]);
    }

    /** The thread each finished chain was sent on, per movement worth judging. */
    const threads = new Map<string, string | null>();

    for (const [movementId, list] of byMovement) {
        if (!list.some((row) => REACHED.includes(row.status))) {
            continue;
        }

        const latest = list.reduce((newest, row) => (row.attempt > newest.attempt ? row : newest));

        // Silence only means something once the chain is over. With another
        // attempt still due — or the last one written minutes ago — "no
        // location" is our own schedule talking rather than the driver's
        // silence: a load that started late in the window would
        // otherwise be judged on a single fifteen-minute-old ping.
        if ((now.getTime() - latest.createdAt.getTime()) / 60_000 < ATTEMPT_GAP_MINUTES) {
            continue;
        }

        if (decideNextAttempt(list, now).action !== "skip") {
            continue;
        }

        threads.set(movementId, latest.conversationId);
    }

    if (threads.size === 0) {
        return { reviewed: 0, alerts: 0 };
    }

    // The runner's own predicate: a load that has since been delivered, had
    // tracking turned off or been handed down to a partner's row is no longer
    // this company's driver to chase. Capped and ordered like the runner's
    // batch as well — the review shares the tick's sixty seconds with the
    // sends, and what it does not reach waits for the window's next tick.
    const movements = await db
        .select()
        .from(movement)
        .where(and(
            inArray(movement.id, [...threads.keys()]),
            inArray(movement.status, TRACKED_STATUSES),
            eq(movement.trackingEnabled, true),
            isNotNull(movement.driverPhone),
            isNotNull(movement.driverName),
            isNull(movement.executionMovementId),
        ))
        .orderBy(asc(movement.startedAt))
        .limit(BATCH_SIZE);

    if (movements.length === 0) {
        return { reviewed: 0, alerts: 0 };
    }

    const threadIds = [...new Set(
        movements.map((row) => threads.get(row.id)).filter((id): id is string => Boolean(id)),
    )];

    // Threads whose pins the order side owns. The webhook tries an order
    // first, and a thread's order link wins outright — including for a load
    // long delivered (resolveOrderForConversation) — so however well this
    // driver answers, his position is filed against that order and the
    // movement's trail stays empty. Judging him would alert his owners, and
    // from the second slot his client, every slot for ever. Admin's runner
    // links the thread of every order it pings (startConversation), so this
    // covers the driver our own runner is already leaving alone too.
    const linked = threadIds.length === 0 ? [] : await db
        .select({ id: chatConversation.id })
        .from(chatConversation)
        .where(and(
            inArray(chatConversation.id, threadIds),
            isNotNull(chatConversation.orderId),
        ));

    const ownedByAdmin = new Set(linked.map((row) => row.id));

    // Which of the batch got a position out of this slot, in one query: a
    // reply closes the requests of every load on the thread, but the pin
    // itself can only be filed against one of them
    // (resolveMovementForConversation), so one driver holding two of his
    // company's loads answers for both at once
    const pings = await db
        .select({ movementId: movementLocation.movementId })
        .from(movementLocation)
        .where(and(
            inArray(movementLocation.movementId, movements.map((row) => row.id)),
            gte(movementLocation.recordedAt, start),
        ));

    const pinged = new Set(pings.map((row) => row.movementId));
    const answered = new Set(
        movements
            .filter((row) => pinged.has(row.id))
            .map((row) => threads.get(row.id))
            .filter((id): id is string => Boolean(id)),
    );

    let reviewed = 0;
    let alerts = 0;

    for (const row of movements) {
        const thread = threads.get(row.id) ?? null;

        if (thread && ownedByAdmin.has(thread)) {
            continue;
        }

        // The load that lost the attribution, not a driver who said nothing
        if (thread && !pinged.has(row.id) && answered.has(thread)) {
            continue;
        }

        reviewed++;

        const issue = await issueFor(db, row, start);

        if (!issue) {
            continue;
        }

        if (await raise(db, row, info, issue)) {
            alerts++;
        }
    }

    return { reviewed, alerts };
}

/** What was wrong with one movement's slot, or null when nothing was. */
async function issueFor(db: typeof Database, row: Movement, start: Date): Promise<TrackingAlertIssue | null> {
    const [latest] = await db
        .select({
            latitude: movementLocation.latitude,
            longitude: movementLocation.longitude,
            placeName: movementLocation.placeName,
        })
        .from(movementLocation)
        .where(and(
            eq(movementLocation.movementId, row.id),
            gte(movementLocation.recordedAt, start),
        ))
        .orderBy(desc(movementLocation.recordedAt))
        .limit(1);

    if (!latest) {
        return "no-location";
    }

    // Infobip fills the name only when the driver picked or searched a place
    // instead of sharing his live position (packages/comms/src/infobip.ts)
    if (latest.placeName !== null) {
        return "picked-address";
    }

    // Only a truck on the road is expected to cover ground: one at the
    // loading site, at the border, offloading or held up stands still by
    // definition, and telling its client it barely moved would be noise
    if (row.status !== "on-route") {
        return null;
    }

    const [previous] = await db
        .select({ latitude: movementLocation.latitude, longitude: movementLocation.longitude })
        .from(movementLocation)
        .where(and(
            eq(movementLocation.movementId, row.id),
            lt(movementLocation.recordedAt, start),
        ))
        .orderBy(desc(movementLocation.recordedAt))
        .limit(1);

    // Nothing to compare the first ping of a load against: a truck that has
    // only ever reported once has not stood still, it has just started
    if (!previous) {
        return null;
    }

    const moved = haversineMeters(
        { lat: previous.latitude, lng: previous.longitude },
        { lat: latest.latitude, lng: latest.longitude },
    );

    return moved < SHORT_DISTANCE_METERS ? "short-distance" : null;
}

/**
 * Tells whoever is owed the alert and records it for the streak. Returns
 * whether anybody was actually told — false on the window's later ticks,
 * whose notifications conflict away on their dedupe key.
 *
 * Told first, recorded after: the notification's (user, dedupeKey) index is
 * what makes a repeated tick harmless, so a run that dies halfway heals on
 * the next tick. Gating the telling on the alert row instead would lose the
 * slot for good, because the row's unique index blocks every retry.
 */
async function raise(
    db: typeof Database,
    row: Movement,
    info: SlotInfo,
    issue: TrackingAlertIssue,
): Promise<boolean> {
    const before = previousSlot(info);

    const [previous] = await db
        .select({ streak: movementTrackingAlert.streak })
        .from(movementTrackingAlert)
        .where(and(
            eq(movementTrackingAlert.movementId, row.id),
            eq(movementTrackingAlert.slotDate, before.slotDate),
            eq(movementTrackingAlert.slot, before.slot),
        ))
        .limit(1);

    const streak = previous ? previous.streak + 1 : 1;

    const owners = await db
        .select({ userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, row.organizationId), eq(member.role, "owner")));

    const params = {
        ref: movementRef(row.seq, row.execution),
        driverName: row.driverName,
        issue,
        streak,
    };
    const dedupeKey = `movement:${row.id}:${info.slotDate}:${info.slot}:alert`;

    // The owners alone, not every member: this is somebody's fleet being run
    // badly, and it is the people who answer for it who have to act on it
    const told = await notify(db, {
        organizationId: row.organizationId,
        userIds: owners.map((owner) => owner.userId),
        kind: "movement.location-alert",
        entityType: "movement",
        entityId: row.id,
        params: { ...params, audience: "owner" },
        email: true,
        dedupeKey,
    });

    // Twice running is no longer an off day, and the client is going to ask
    // where its cargo is before we tell it — so we tell it first. Its own
    // audience, because the closing sentence of the copy addresses the reader
    // and the transporter's reads "the client was told too".
    if (streak >= 2 && row.clientOrgId) {
        await notify(db, {
            organizationId: row.clientOrgId,
            kind: "movement.location-alert",
            entityType: "movement",
            entityId: row.id,
            params: { ...params, audience: "client" },
            email: true,
            dedupeKey: `${dedupeKey}:client`,
        });
    }

    // The streak's only record, and the one thing a later tick must not
    // double — the unique index sees to that
    await db
        .insert(movementTrackingAlert)
        .values({ movementId: row.id, slotDate: info.slotDate, slot: info.slot, issue, streak })
        .onConflictDoNothing();

    return told > 0;
}
