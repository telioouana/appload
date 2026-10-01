import { NextRequest, NextResponse } from "next/server";

import { db } from "@workspace/db/db";
import { authorizeCron } from "@workspace/comms/cron";

import { runRentalCheckinSlot } from "@workspace/domain/rentals/checkin";
import { currentSlotInfo } from "@workspace/domain/tracking/slot";

export const maxDuration = 60;

/**
 * The morning question to every rented truck's driver — "is the truck at the
 * client's service today?" — fired by QStash every 15 minutes across the
 * morning window (apps/app/scripts/qstash-schedules.mjs). Like the trips'
 * tracking, each line is judged on its own request chain rather than on the
 * clock, so a repeated tick is a no-op and a missed one heals on the next.
 * The afternoon window and anything outside both are no-ops.
 */
async function handle(request: NextRequest) {
    if (!await authorizeCron(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const info = currentSlotInfo();

    if (!info || info.slot !== "morning") {
        return NextResponse.json({ skipped: "outside the morning window" });
    }

    const summary = await runRentalCheckinSlot(db, info);

    console.log("[cron:rental-checkin]", JSON.stringify(summary));

    return NextResponse.json(summary);
}

export const GET = handle;
export const POST = handle;
