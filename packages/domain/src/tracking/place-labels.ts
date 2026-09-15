/**
 * The lazy half of place labels. The webhook labels a ping as it arrives;
 * this labels the ones it could not (Google down, no key yet, every pin
 * recorded before the column existed) the first time a map overview reads
 * them — so the calls go to the pins somebody is looking at, and each pin is
 * bought once.
 */

import { eq, inArray } from "drizzle-orm";

import type { db as Database } from "@workspace/db/db";
import { movementLocation } from "@workspace/db/movements";
import { orderLocation } from "@workspace/db/tracking";
import { reverseGeocode } from "@workspace/maps/server/reverse-geocode";

/**
 * How many labels one call resolves. An overview is polled on a timer, so a
 * backlog drains a page at a time rather than holding one request open for
 * every unlabelled pin at once; the rest come on the next poll.
 */
const BATCH = 25;

const TABLES = { order: orderLocation, movement: movementLocation } as const;

/**
 * Resolves and stores the label of every given location row that still has
 * none, at most `BATCH` of them, and returns the labels by row id — only for
 * the rows it actually labelled, so a caller merges over what it already
 * read. Nothing is written for a ping Google could not place: it stays null
 * and is tried again on the next read, which is the right call for a
 * transient failure and cheap for the rare pin at sea.
 */
export async function fillPlaceLabels(
    db: typeof Database,
    table: "order" | "movement",
    ids: string[],
): Promise<Map<string, string>> {
    const labels = new Map<string, string>();

    if (ids.length === 0) return labels;

    const location = TABLES[table];

    const rows = await db
        .select({ id: location.id, latitude: location.latitude, longitude: location.longitude, placeLabel: location.placeLabel })
        .from(location)
        .where(inArray(location.id, ids));

    const missing = rows.filter((row) => row.placeLabel === null).slice(0, BATCH);

    // In parallel: each is one short Google call, and the overview is waiting
    const resolved = await Promise.all(missing.map(async (row) => ({
        id: row.id,
        label: await reverseGeocode({ latitude: row.latitude, longitude: row.longitude }),
    })));

    for (const { id, label } of resolved) {
        if (label === null) continue;

        await db.update(location).set({ placeLabel: label }).where(eq(location.id, id));
        labels.set(id, label);
    }

    return labels;
}
