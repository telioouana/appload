import { and, desc, eq } from "drizzle-orm";

import { type Order } from "@workspace/db/orders";
import { chatMessage, type TrackingRequest, type TrackingSlot } from "@workspace/db/chats";
import type { db as Database } from "@workspace/db/db";

/**
 * The tracking sweep's decision layer: when a slot is open, what the next
 * attempt for one order is, which channel carries it and what it says.
 *
 * Pure or read-only on purpose — the sending half stays with the app that
 * owns the Infobip credentials, so the decision table can be reasoned about
 * (and shared) without dragging an outbound message along with it.
 */

// Maputo is fixed UTC+2 (no DST): schedules and slots are static
export const MAPUTO_OFFSET_MS = 2 * 3_600_000;

/** WhatsApp, WhatsApp again, then SMS. */
export const MAX_ATTEMPTS = 3;

/**
 * The pacing rule, and the reason the schedule no longer has to be precise:
 * an order whose last attempt is younger than this is left alone. A repeated
 * or duplicated tick becomes a no-op, and the ~30-minute cadence holds no
 * matter when ticks actually land.
 */
export const ATTEMPT_GAP_MINUTES = 25;

/**
 * A claim row is written before the send and updated after it. If the
 * function dies in between, the row is stuck at "pending" and would block
 * that attempt forever. Past this age we re-send it: one duplicate location
 * request is strictly better than a slot that silently never sends.
 */
export const STUCK_MINUTES = 10;

/** Orders handled per invocation; the next tick picks up the remainder. */
export const BATCH_SIZE = 25;

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

/**
 * State-level place name for message copy — mirrors the UI's `place()`
 * helper (order-item-shared.tsx): province when present, else the first
 * segment of the formatted address.
 */
export const place = (location: Order["loadingAddress"]) =>
    location.state || location.address.split(",")[0]?.trim() || location.address;

// Deliberately unaccented so the hardcoded part stays GSM-7; place names
// from the database may still carry accents
export const smsText = (driverName: string, row: Order) =>
    `Ola ${driverName}, a Appload pede a sua localizacao atual para a carga ${row.orderId} (camiao ${row.truckPlate ?? "s/ matricula"}, ${place(row.loadingAddress)} para ${place(row.offloadingAddress)}). Por favor responda a esta mensagem com a sua localizacao.`;

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

export const channelFor = (attempt: number) => (attempt >= MAX_ATTEMPTS ? "sms" : "whatsapp");

/**
 * WhatsApp's customer-service window is 24h from the driver's last inbound
 * message; one hour of margin keeps a request from racing the window's edge.
 */
export const SESSION_WINDOW_HOURS = 23;

/**
 * Whether the driver's 24h session window is still open — true when the
 * conversation holds an inbound message younger than the (margin-trimmed)
 * window. Drivers who answer their twice-daily pings keep the window open
 * continuously, so this is the common case, not the exception.
 */
export async function hasOpenSession(db: typeof Database, conversationId: string | null): Promise<boolean> {
    if (!conversationId) {
        return false;
    }

    const [lastInbound] = await db
        .select({ createdAt: chatMessage.createdAt })
        .from(chatMessage)
        .where(and(
            eq(chatMessage.conversationId, conversationId),
            eq(chatMessage.direction, "inbound"),
        ))
        .orderBy(desc(chatMessage.createdAt))
        .limit(1);

    return lastInbound !== undefined
        && Date.now() - lastInbound.createdAt.getTime() < SESSION_WINDOW_HOURS * 3_600_000;
}
