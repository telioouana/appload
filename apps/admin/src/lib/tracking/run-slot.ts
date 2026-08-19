import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { order, type Order } from "@workspace/db/orders";
import { chatConversation, chatMessage, trackingRequest, type TrackingRequest, type TrackingSlot } from "@workspace/db/chats";
import type { db as Database } from "@workspace/db/db";
import type { ORDER_STATUS } from "@workspace/db/types";

import { sendSmsText, sendWhatsAppTemplate } from "@/lib/chats/infobip";

type OrderStatus = (typeof ORDER_STATUS)[number];

// Any order with a truck committed gets pinged twice daily — the full
// active set, including interrupts and the border
export const TRACKED_STATUSES: OrderStatus[] = [
    "to-loading", "at-loading", "loading", "waiting-documents",
    "on-route", "stopped", "issue", "at-border", "at-offloading", "offloading",
];

// Maputo is fixed UTC+2 (no DST): schedules and slots are static
const MAPUTO_OFFSET_MS = 2 * 3_600_000;

/** WhatsApp, WhatsApp again, then SMS. */
export const MAX_ATTEMPTS = 3;

/**
 * The pacing rule, and the reason the schedule no longer has to be precise:
 * an order whose last attempt is younger than this is left alone. A repeated
 * or duplicated tick becomes a no-op, and the ~30-minute cadence holds no
 * matter when ticks actually land.
 */
const ATTEMPT_GAP_MINUTES = 25;

/**
 * A claim row is written before the send and updated after it. If the
 * function dies in between, the row is stuck at "pending" and would block
 * that attempt forever. Past this age we re-send it: one duplicate location
 * request is strictly better than a slot that silently never sends.
 */
const STUCK_MINUTES = 10;

/** Orders handled per invocation; the next tick picks up the remainder. */
const BATCH_SIZE = 25;

const MINUTE_MS = 60_000;

export type SlotInfo = {
    slotDate: string;
    slot: TrackingSlot;
};

/**
 * Which slot (if any) the current time falls in. The window is deliberately
 * wide — 07:55-09:45 and 16:55-18:45 Maputo — because the firing time no
 * longer decides the attempt: `runTrackingSlot` derives that per order from
 * what it has already sent. A tick that arrives late still does the right
 * thing instead of being relabelled as a later attempt.
 */
export function currentSlotInfo(now: Date = new Date()): SlotInfo | null {
    const local = new Date(now.getTime() + MAPUTO_OFFSET_MS);
    const slotDate = local.toISOString().slice(0, 10);
    const minutesOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();

    for (const { slot, start } of [
        { slot: "morning" as const, start: 8 * 60 },
        { slot: "afternoon" as const, start: 17 * 60 },
    ]) {
        const offset = minutesOfDay - start;

        // -5 min of tolerance for an early tick, and long enough after the
        // start for all three attempts to still fit
        if (offset >= -5 && offset <= 105) {
            return { slotDate, slot };
        }
    }

    return null;
}

const smsText = (driverName: string, orderId: string) =>
    `Ola ${driverName}, a Appload pede a sua localizacao atual para a carga ${orderId}. Por favor responda a esta mensagem com a sua localizacao.`;

export type SlotRunSummary = {
    slot: SlotInfo;
    eligible: number;
    sent: number;
    resent: number;
    skipped: number;
    failed: number;
};

/**
 * What the next action for one order is, given every tracking row already
 * written for this slot. Pure, so the decision table is testable and the
 * scheduler stays dumb.
 */
type Decision =
    | { action: "skip" }
    | { action: "send"; attempt: number }
    | { action: "resend"; row: TrackingRequest };

export function decideNextAttempt(rows: TrackingRequest[], now: Date): Decision {
    if (rows.length === 0) {
        return { action: "send", attempt: 1 };
    }

    // The driver answered — nothing more to ask for this slot
    if (rows.some((row) => row.status === "responded")) {
        return { action: "skip" };
    }

    const latest = rows.reduce((newest, row) => (row.attempt > newest.attempt ? row : newest));
    const ageMinutes = (now.getTime() - latest.createdAt.getTime()) / MINUTE_MS;

    // Interrupted between claim and send: finish the job rather than let the
    // orphaned row block this attempt forever
    if (latest.status === "pending" && ageMinutes >= STUCK_MINUTES) {
        return { action: "resend", row: latest };
    }

    // Too soon — this is what makes duplicate ticks harmless
    if (ageMinutes < ATTEMPT_GAP_MINUTES) {
        return { action: "skip" };
    }

    if (latest.attempt >= MAX_ATTEMPTS) {
        return { action: "skip" };
    }

    // Escalating to SMS is only worth it when WhatsApp never landed. A
    // delivered message that simply went unanswered means the driver is
    // reachable and chose not to reply.
    if (latest.attempt === MAX_ATTEMPTS - 1 && latest.status === "delivered") {
        return { action: "skip" };
    }

    return { action: "send", attempt: latest.attempt + 1 };
}

const channelFor = (attempt: number) => (attempt >= MAX_ATTEMPTS ? "sms" : "whatsapp");

/**
 * Runs one tick of one slot. Every order is judged on its own history
 * rather than on the clock, so the sweep is idempotent under duplicate
 * deliveries and self-healing when a tick is missed entirely: if the 08:00
 * fire never happens, the 08:15 one sends attempt 1.
 */
export async function runTrackingSlot(db: typeof Database, info: SlotInfo): Promise<SlotRunSummary> {
    const summary: SlotRunSummary = { slot: info, eligible: 0, sent: 0, resent: 0, skipped: 0, failed: 0 };
    const now = new Date();

    const orders = await db
        .select()
        .from(order)
        .where(and(
            inArray(order.status, TRACKED_STATUSES),
            isNotNull(order.driverPhoneNumber),
        ))
        .limit(BATCH_SIZE);

    summary.eligible = orders.length;

    if (orders.length === 0) {
        return summary;
    }

    // Every row written for this slot, whatever the attempt — the decision
    // for each order is read from these, never from the firing time
    const priorRows = await db
        .select()
        .from(trackingRequest)
        .where(and(
            eq(trackingRequest.slotDate, info.slotDate),
            eq(trackingRequest.slot, info.slot),
            inArray(trackingRequest.orderId, orders.map((row) => row.id)),
        ));

    const byOrder = new Map<string, TrackingRequest[]>();
    for (const row of priorRows) {
        const list = byOrder.get(row.orderId);
        if (list) list.push(row); else byOrder.set(row.orderId, [row]);
    }

    for (const row of orders) {
        const decision = decideNextAttempt(byOrder.get(row.id) ?? [], now);

        if (decision.action === "skip") {
            summary.skipped++;
            continue;
        }

        const outcome = decision.action === "resend"
            ? await send(db, row, decision.row)
            : await claimAndSend(db, row, info, decision.attempt);

        if (outcome === "sent") {
            summary.sent++;
            if (decision.action === "resend") summary.resent++;
        } else if (outcome === "failed") {
            summary.failed++;
        } else {
            summary.skipped++;
        }
    }

    return summary;
}

/**
 * Claims the (order, slot, attempt) before anything leaves the building:
 * the unique index means a concurrent or repeated run gets zero rows back
 * and walks away.
 */
async function claimAndSend(
    db: typeof Database,
    row: Order,
    info: SlotInfo,
    attempt: number,
): Promise<"sent" | "failed" | "skipped"> {
    const [conversation] = await db
        .select({ id: chatConversation.id })
        .from(chatConversation)
        .where(eq(chatConversation.driverPhone, row.driverPhoneNumber!))
        .limit(1);

    const [claim] = await db
        .insert(trackingRequest)
        .values({
            orderId: row.id,
            conversationId: conversation?.id ?? null,
            slotDate: info.slotDate,
            slot: info.slot,
            attempt,
            channel: channelFor(attempt),
            scheduledFor: new Date(),
        })
        .onConflictDoNothing()
        .returning();

    if (!claim) {
        return "skipped";
    }

    return send(db, row, claim);
}

/** Sends the message a claim row stands for and records the outcome. */
async function send(
    db: typeof Database,
    row: Order,
    claim: TrackingRequest,
): Promise<"sent" | "failed"> {
    const phone = row.driverPhoneNumber!;
    const driverName = row.driverName ?? "motorista";
    const body = smsText(driverName, row.orderId);

    const result = claim.channel === "sms"
        ? await sendSmsText(phone, body)
        : await sendWhatsAppTemplate(phone, [driverName, row.orderId]);

    await db
        .update(trackingRequest)
        .set(result.ok
            ? { status: "sent", externalId: result.externalId, error: null }
            : { status: "failed", error: result.error })
        .where(eq(trackingRequest.id, claim.id));

    // Mirror the outbound ping into the chat thread so operators see the
    // whole exchange in one place
    if (result.ok && claim.conversationId) {
        const [message] = await db
            .insert(chatMessage)
            .values({
                conversationId: claim.conversationId,
                direction: "outbound",
                body,
                status: "sent",
                externalId: result.externalId,
            })
            .returning();

        if (message) {
            await db
                .update(chatConversation)
                .set({ lastMessageAt: message.createdAt })
                .where(eq(chatConversation.id, claim.conversationId));
        }
    }

    return result.ok ? "sent" : "failed";
}
