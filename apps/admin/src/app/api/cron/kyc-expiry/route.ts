import { NextRequest, NextResponse } from "next/server";

import { db } from "@workspace/db/db";

import { authorizeCron } from "@/lib/cron/verify";
import { runExpirySweep } from "@/lib/kyc/expiry";

// Sequential per-subject recomputation; the candidate set is bounded by how
// many documents are near expiry, not by the size of the partner base.
// 60 is the Vercel Hobby maximum
export const maxDuration = 60;

/**
 * Daily KYC expiry sweep, fired by QStash at 06:30 Maputo (see
 * apps/admin/scripts/qstash-schedules.mjs).
 *
 * Flips stored `kycStatus` from `verified` to `expired` once a required
 * document's date has passed, and counts what expires within the 30- and
 * 7-day horizons. Safe to run at any time and any number of times: the
 * sweep is a pure recomputation, so a duplicate delivery is a no-op and a
 * missed day is corrected by the next run.
 */
async function handle(request: NextRequest) {
    if (!await authorizeCron(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const summary = await runExpirySweep(db);

    console.log("[cron:kyc-expiry]", JSON.stringify({
        checked: summary.checked,
        changed: summary.changed.length,
        expiringSoon: summary.expiringSoon,
    }));

    return NextResponse.json(summary);
}

// QStash delivers over POST; GET stays for manual runs with the bearer token
export const GET = handle;
export const POST = handle;
