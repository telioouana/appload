import { NextRequest, NextResponse } from "next/server";

import { db } from "@workspace/db/db";
import { authorizeCron } from "@workspace/comms/cron";

import { currentSlotInfo } from "@workspace/domain/tracking/slot";
import { runMovementTrackingSlot } from "@workspace/domain/tracking/movement-slot";

// Sequential Infobip + Neon-HTTP round trips per trip; the batch cap in the
// runner keeps this inside the ceiling. 60 is the Vercel Hobby maximum —
// the handler is resumable, so QStash retries continue where a run stopped
export const maxDuration = 60;

/**
 * Location requests for the standalone trips partners track here, fired by
 * QStash every 15 minutes across the two slot windows (08:00-09:45 and
 * 17:00-18:45 Maputo — see apps/app/scripts/qstash-schedules.mjs). Orders are
 * the admin cron's business and are never pinged twice.
 *
 * The firing time only selects the slot; how far along that slot's retry
 * chain each trip is comes from the database, so extra ticks are no-ops and
 * a missed tick heals on the next one. Outside both windows the run is a
 * no-op, which makes the route safe to hit manually at any time.
 */
async function handle(request: NextRequest) {
    if (!await authorizeCron(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const info = currentSlotInfo();

    if (!info) {
        return NextResponse.json({ skipped: "outside slot windows" });
    }

    const summary = await runMovementTrackingSlot(db, info);

    console.log("[cron:trips-tracking]", JSON.stringify(summary));

    return NextResponse.json(summary);
}

// QStash delivers over POST; GET stays for manual runs with the bearer token
export const GET = handle;
export const POST = handle;
