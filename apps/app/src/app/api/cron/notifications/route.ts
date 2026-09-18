import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";

import { db } from "@workspace/db/db";
import { notification, notificationCursor } from "@workspace/db/notifications";
import { organization, user } from "@workspace/db/users";
import { APPLOAD_ORG_ID } from "@workspace/db/types";

import { isEmailConfigured, sendEmail } from "@workspace/auth/email";
import { authorizeCron } from "@workspace/comms/cron";
import { materializeOrderEvents } from "@workspace/domain/notifications/materialize";

import { notificationTarget } from "@/frontend/pages/notifications/types";
import { renderNotificationEmail } from "@/lib/notification-email";

// Organizations read per run. The ceiling is the 60 s function budget, not
// the model: a portal larger than one batch is still covered, because the
// window rotates on how long ago each one was last read
const ORGANIZATION_BATCH = 100;
const EMAIL_BATCH = 25;
const MAX_ATTEMPTS = 5;

// One Resend round trip plus one row update per email, sequential. 60 is the
// Vercel Hobby maximum — a run that stops short leaves the rest pending, so
// the next tick continues where this one ended
export const maxDuration = 60;

/**
 * The notification centre's background half, fired by QStash every five
 * minutes (see apps/app/scripts/qstash-schedules.mjs).
 *
 * Two steps. Reading the order trail turns what staff did in the admin into
 * notifications — `notifications.unreadCount` does the same for whoever is
 * looking, and this run is what makes it happen for everyone who is not.
 * Sweeping the outbox then sends the emails the writers asked for.
 *
 * Safe to call as often as anything likes: materialization is idempotent
 * through the notification dedupe key, and a row is claimed out of the outbox
 * before it is sent, so two runs that overlap cannot email anyone twice.
 */
async function handle(request: NextRequest) {
    if (!await authorizeCron(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const materialized = await materializeActivatedOrganizations();
    const outbox = await sweepOutbox();

    const summary = { materialized, ...outbox };

    console.log("[cron:notifications]", JSON.stringify(summary));

    return NextResponse.json(summary);
}

/** How many notifications the admin's order trail produced this run. */
async function materializeActivatedOrganizations(): Promise<number> {
    const organizations = await db
        .select({ id: organization.id })
        .from(organization)
        .leftJoin(notificationCursor, eq(notificationCursor.organizationId, organization.id))
        // Appload's own row is on the portal and has no members to tell
        .where(and(isNotNull(organization.portalActivatedAt), ne(organization.id, APPLOAD_ORG_ID)))
        // Least recently read first, which is what makes the batch a rotating
        // window instead of a prefix: a portal with more activated companies
        // than one run can hold still reaches every one of them in turn, and
        // one that has never been read (no cursor row yet) comes first
        .orderBy(sql`${notificationCursor.updatedAt} asc nulls first`)
        .limit(ORGANIZATION_BATCH);

    let inserted = 0;

    for (const row of organizations) {
        try {
            inserted += (await materializeOrderEvents(db, row.id)).inserted;
        } catch (error) {
            // One organization's trail must not cost all the others their
            // emails: its cursor stays where it is and the next run retries
            console.error(`[cron:notifications] materialize ${row.id}:`, error);
        }
    }

    // Everyone read this run moves to the back of the queue, including the
    // ones with nothing new and the ones that threw: the position is when the
    // organization was last looked at, not when its trail last moved, or a
    // quiet or broken company would hold the head of the window for good
    if (organizations.length > 0) {
        await db
            .update(notificationCursor)
            .set({ updatedAt: new Date() })
            .where(inArray(notificationCursor.organizationId, organizations.map((row) => row.id)));
    }

    return inserted;
}

async function sweepOutbox(): Promise<{ emailed: number; failed: number; skipped: number }> {
    const waiting = await db
        .select({
            id: notification.id,
            kind: notification.kind,
            params: notification.params,
            entityType: notification.entityType,
            entityId: notification.entityId,
            recipient: user.email,
        })
        .from(notification)
        .innerJoin(user, eq(user.id, notification.userId))
        .where(and(eq(notification.emailState, "pending"), lt(notification.emailAttempts, MAX_ATTEMPTS)))
        .orderBy(asc(notification.createdAt))
        .limit(EMAIL_BATCH);

    // With no provider configured every send would come back as a failure
    // and burn the row's attempts; the outbox waits instead, so a production
    // key that arrives late still delivers what queued up behind it
    if (!isEmailConfigured()) {
        return { emailed: 0, failed: 0, skipped: waiting.length };
    }

    if (waiting.length === 0) {
        return { emailed: 0, failed: 0, skipped: 0 };
    }

    // The claim is what makes two runs over the same rows harmless: taking a
    // row out of "pending" and counting its attempt in one statement, so the
    // slower run's update re-reads a row that is no longer pending and comes
    // back without it rather than sending the same email again
    const claimed = await db
        .update(notification)
        .set({ emailState: "sending", emailAttempts: sql`${notification.emailAttempts} + 1` })
        .where(and(
            eq(notification.emailState, "pending"),
            lt(notification.emailAttempts, MAX_ATTEMPTS),
            inArray(notification.id, waiting.map((row) => row.id)),
        ))
        .returning({ id: notification.id, attempts: notification.emailAttempts });

    const attemptsById = new Map(claimed.map((row) => [row.id, row.attempts]));

    let emailed = 0;
    let failed = 0;

    for (const row of waiting) {
        const attempts = attemptsById.get(row.id);

        // Someone else's run took this one between the read and the claim
        if (attempts === undefined) continue;

        try {
            const { subject, html } = renderNotificationEmail({
                kind: row.kind,
                params: row.params,
                // The same table the in-app row is linked from, so the button
                // in the inbox and the button in the email land on one page
                href: notificationTarget(row.entityType, row.entityId)?.path ?? null,
            });

            const result = await sendEmail({ to: [row.recipient], subject, html });

            if (result.ok) {
                await db.update(notification).set({ emailState: "sent" }).where(eq(notification.id, row.id));
                emailed++;
                continue;
            }

            await release(row.id, attempts, result.error);
            failed++;
        } catch (error) {
            // A row whose message cannot be built is released like a refused
            // one rather than left claimed: it keeps the attempt it just
            // spent, so an unrenderable row ages out of the queue instead of
            // being the oldest thing in every batch from now on
            await release(row.id, attempts, String(error));
            failed++;
            console.error(`[cron:notifications] send ${row.id}:`, error);
        }
    }

    return { emailed, failed, skipped: 0 };
}

/** Puts a claimed row back in the queue, or out of it once it has tried enough. */
async function release(id: string, attempts: number, error: string): Promise<void> {
    try {
        await db
            .update(notification)
            .set({
                // Five refusals is a bad address or a bad message, not a bad
                // minute: the row stops asking and keeps its reason
                emailState: attempts < MAX_ATTEMPTS ? "pending" : "failed",
                emailLastError: error.slice(0, 500),
            })
            .where(eq(notification.id, id));
    } catch (failure) {
        // The row stays claimed and nobody is emailed twice for it; the rest
        // of the batch still goes out
        console.error(`[cron:notifications] release ${id}:`, failure);
    }
}

// QStash delivers over POST; GET stays for manual runs with the bearer token
export const GET = handle;
export const POST = handle;
