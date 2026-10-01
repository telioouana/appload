import "server-only";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { chatConversation, chatMessage } from "@workspace/db/chats";
import { contract, contractAllocation } from "@workspace/db/contracts";
import type { db as Database } from "@workspace/db/db";
import { driver, truck } from "@workspace/db/fleet";
import { rentalCheckinRequest, rentalDay, type RentalCheckinRequest } from "@workspace/db/rentals";
import { organization, user } from "@workspace/db/users";
import {
    RENTAL_CHECKIN_PAYLOAD,
    rentalCheckinPayload,
    rentalCheckinTemplateText,
    sendWhatsAppTemplate,
} from "@workspace/comms/infobip";

import { todayInMaputo } from "@workspace/domain/contracts/price";
import { startConversation } from "@workspace/domain/tracking/conversations";
import { decideNextAttempt, place, type SlotInfo } from "@workspace/domain/tracking/slot";

type Db = typeof Database;

/**
 * The morning question to a rented truck's driver: is the truck at the
 * client's service today, yes or no. A yes is noted on the day; a no makes
 * it an off day the transporter may correct; silence leaves no row and
 * reads as "no answer" on the page. WhatsApp only — a yes/no needs buttons,
 * and an SMS third attempt would have none to press.
 */

export type RentalCheckinSummary = { slot: SlotInfo; due: number; sent: number; resent: number; skipped: number; failed: number };

type DueLine = {
    allocationId: string;
    contractId: string;
    reference: string | null;
    mode: "calendar" | "working";
    clientName: string | null;
    clientOrgName: string | null;
    site: string;
    truckPlate: string | null;
    driverName: string | null;
    driverPhone: string | null;
};

/**
 * The lines to ask today: active rentals in their period, whose line has not
 * ended, with a driver on the portal, on a day the mode counts, and no
 * answer yet.
 */
export async function rentalLinesDueToday(db: Db, today = todayInMaputo()): Promise<DueLine[]> {
    const rows = await db
        .select({
            allocationId: contractAllocation.id,
            contractId: contract.id,
            reference: contract.reference,
            sellPrice: contract.sellPrice,
            buyPrice: contractAllocation.buyPrice,
            clientName: contract.clientName,
            clientOrgName: organization.name,
            origin: contract.origin,
            truckPlate: sql<string | null>`coalesce(${truck.regPlate}, ${contractAllocation.truckPlate})`,
            driverName: user.name,
            driverPhone: user.phoneNumber,
        })
        .from(contractAllocation)
        .innerJoin(contract, eq(contract.id, contractAllocation.contractId))
        .innerJoin(driver, eq(driver.id, contractAllocation.driverId))
        .innerJoin(user, eq(user.id, driver.userId))
        .leftJoin(truck, eq(truck.id, contractAllocation.truckId))
        .leftJoin(organization, eq(organization.id, contract.clientOrgId))
        .where(and(
            eq(contract.basis, "days"),
            eq(contract.status, "active"),
            sql`${contract.startsOn} <= ${today}`,
            or(isNull(sql`coalesce(${contractAllocation.endsOn}, ${contract.endsOn})`), sql`coalesce(${contractAllocation.endsOn}, ${contract.endsOn}) >= ${today}`),
            isNotNull(user.phoneNumber),
            // Not asked twice: an answer already filed closes the day
            sql`not exists (select 1 from ${rentalDay} d where d."allocation_id" = ${contractAllocation.id} and d."day" = ${today} and d."driver_answer" is not null)`,
        ));

    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();

    return rows.flatMap((row) => {
        // The line's own mode (a partner's price) else the order's; working days skip Sundays
        const model = row.buyPrice?.model === "per-day" ? row.buyPrice : row.sellPrice?.model === "per-day" ? row.sellPrice : null;
        const mode = model?.billableDays ?? "calendar";
        if (mode === "working" && weekday === 0) return [];

        return [{
            allocationId: row.allocationId,
            contractId: row.contractId,
            reference: row.reference,
            mode,
            clientName: row.clientName,
            clientOrgName: row.clientOrgName,
            site: row.origin ? place(row.origin) : "—",
            truckPlate: row.truckPlate,
            driverName: row.driverName,
            driverPhone: row.driverPhone,
        }];
    });
}

/** One tick of the morning slot over the lines due today. */
export async function runRentalCheckinSlot(db: Db, info: SlotInfo): Promise<RentalCheckinSummary> {
    const summary: RentalCheckinSummary = { slot: info, due: 0, sent: 0, resent: 0, skipped: 0, failed: 0 };
    if (info.slot !== "morning") return summary;

    const lines = await rentalLinesDueToday(db, info.slotDate);
    summary.due = lines.length;
    if (lines.length === 0) return summary;

    const prior = await db
        .select()
        .from(rentalCheckinRequest)
        .where(and(eq(rentalCheckinRequest.day, info.slotDate), inArray(rentalCheckinRequest.allocationId, lines.map((line) => line.allocationId))));
    const byLine = new Map<string, RentalCheckinRequest[]>();
    for (const row of prior) byLine.set(row.allocationId, [...(byLine.get(row.allocationId) ?? []), row]);

    const now = new Date();
    for (const line of lines) {
        const decision = decideNextAttempt(byLine.get(line.allocationId) ?? [], now);
        if (decision.action === "skip") { summary.skipped++; continue; }

        const outcome = decision.action === "resend"
            ? await send(db, line, decision.row)
            : await claimAndSend(db, line, info, decision.attempt);

        if (outcome === "sent") { summary.sent++; if (decision.action === "resend") summary.resent++; }
        else if (outcome === "failed") summary.failed++;
        else summary.skipped++;
    }

    return summary;
}

async function claimAndSend(db: Db, line: DueLine, info: SlotInfo, attempt: number): Promise<"sent" | "failed" | "skipped"> {
    if (!line.driverPhone || !line.driverName) return "skipped";

    let conversationId: string | null = null;
    try {
        conversationId = (await startConversation(db, { driverName: line.driverName, driverPhone: line.driverPhone })).conversation.id;
    } catch (error) {
        console.error(`rental check-in: ensure conversation failed for ${line.reference ?? line.allocationId}`, error);
    }

    const [claim] = await db
        .insert(rentalCheckinRequest)
        .values({ allocationId: line.allocationId, conversationId, day: info.slotDate, attempt, channel: "whatsapp", scheduledFor: new Date() })
        .onConflictDoNothing()
        .returning();

    if (!claim) return "skipped";
    return send(db, line, claim);
}

async function send(db: Db, line: DueLine, claim: RentalCheckinRequest): Promise<"sent" | "failed"> {
    const client = line.clientOrgName ?? line.clientName ?? "—";
    const body = rentalCheckinTemplateText(line.driverName ?? "—", line.truckPlate ?? "—", client, line.site);
    const result = await sendWhatsAppTemplate(
        line.driverPhone!,
        [line.driverName ?? "—", line.truckPlate ?? "—", client, line.site],
        [rentalCheckinPayload("yes", line.allocationId, claim.day), rentalCheckinPayload("no", line.allocationId, claim.day)],
        process.env.INFOBIP_RENTAL_TEMPLATE,
    );

    await db
        .update(rentalCheckinRequest)
        .set(result.ok ? { status: "sent", externalId: result.externalId, error: null } : { status: "failed", error: result.error })
        .where(eq(rentalCheckinRequest.id, claim.id));

    if (result.ok && claim.conversationId) {
        const [message] = await db
            .insert(chatMessage)
            .values({ conversationId: claim.conversationId, direction: "outbound", body, status: "sent", externalId: result.externalId })
            .returning();
        if (message) await db.update(chatConversation).set({ lastMessageAt: message.createdAt }).where(eq(chatConversation.id, claim.conversationId));
    }

    return result.ok ? "sent" : "failed";
}

/**
 * The driver pressed Sim or Não. The payload names the line and the day; it
 * is believed only when a request for that line and day went out — a forged
 * payload files nothing. A yes is noted on the day; a no makes it an off day
 * the transporter may correct. Returns whether anything was filed.
 */
export async function recordRentalAnswer(db: Db, input: { payload: string; conversationId: string | null }): Promise<boolean> {
    const match = /^rental-(yes|no):([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(input.payload);
    if (!match) return false;
    const answer = match[1] as "yes" | "no";
    const allocationId = match[2]!;
    const day = match[3]!;

    const [asked] = await db
        .select({ id: rentalCheckinRequest.id })
        .from(rentalCheckinRequest)
        .where(and(eq(rentalCheckinRequest.allocationId, allocationId), eq(rentalCheckinRequest.day, day)))
        .limit(1);
    if (!asked) return false;

    const answered = { driverAnswer: answer, answeredAt: new Date() } as const;
    await db
        .insert(rentalDay)
        .values(answer === "no"
            ? { allocationId, day, state: "off", note: "motorista: não", ...answered }
            : { allocationId, day, state: "worked", ...answered })
        .onConflictDoUpdate({
            target: [rentalDay.allocationId, rentalDay.day],
            // A no overrides a default day; a day the transporter already marked keeps its mark
            set: answer === "no"
                ? { ...answered, state: sql`case when ${rentalDay.recordedBy} is null then 'off' else ${rentalDay.state} end` }
                : answered,
        });

    await db
        .update(rentalCheckinRequest)
        .set({ status: "responded" })
        .where(and(eq(rentalCheckinRequest.allocationId, allocationId), eq(rentalCheckinRequest.day, day), inArray(rentalCheckinRequest.status, ["pending", "sent", "delivered"])));

    return true;
}

/** Whether `payload` is one of ours. */
export const isRentalCheckinPayload = (payload: string | null | undefined): payload is string =>
    typeof payload === "string" && payload.startsWith(RENTAL_CHECKIN_PAYLOAD);

/** Lines asked on `day` that never answered, for the page's "sem resposta" mark. */
export async function silentLines(db: Db, allocationIds: string[], day: string): Promise<Set<string>> {
    if (allocationIds.length === 0) return new Set();

    const rows = await db
        .select({ allocationId: rentalCheckinRequest.allocationId })
        .from(rentalCheckinRequest)
        .where(and(
            inArray(rentalCheckinRequest.allocationId, allocationIds),
            eq(rentalCheckinRequest.day, day),
            inArray(rentalCheckinRequest.status, ["sent", "delivered"]),
            sql`not exists (select 1 from ${rentalDay} d where d."allocation_id" = ${rentalCheckinRequest.allocationId} and d."day" = ${day} and d."driver_answer" is not null)`,
        ));

    return new Set(rows.map((row) => row.allocationId));
}
