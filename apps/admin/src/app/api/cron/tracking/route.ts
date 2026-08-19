import { NextRequest, NextResponse } from "next/server";

import { db } from "@workspace/db/db";

import { authorizeCron } from "@/lib/cron/verify";
import { currentSlotInfo, runTrackingSlot } from "@/lib/tracking/run-slot";

// Sequential Infobip + Neon-HTTP round trips per order; the batch cap in
// run-slot keeps this inside the ceiling. 60 is the Vercel Hobby maximum —
// the handler is resumable, so QStash retries continue where a run stopped
export const maxDuration = 60;

/**
 * Driver location requests, fired by QStash every 15 minutes across the two
 * slot windows (08:00-09:45 and 17:00-18:45 Maputo — see
 * apps/admin/scripts/qstash-schedules.mjs).
 *
 * The firing time only selects the slot; how far along that slot's retry
 * chain each order is comes from the database, so extra ticks are no-ops
 * and a missed tick heals on the next one. Outside both windows the run is
 * a no-op, which makes the route safe to hit manually at any time.
 */
async function handle(request: NextRequest) {
    if (!await authorizeCron(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const info = currentSlotInfo();

    if (!info) {
        return NextResponse.json({ skipped: "outside slot windows" });
    }

    const summary = await runTrackingSlot(db, info);

    console.log("[cron:tracking]", JSON.stringify(summary));

    return NextResponse.json(summary);
}

// QStash delivers over POST; GET stays for manual runs with the bearer token
export const GET = handle;
export const POST = handle;
