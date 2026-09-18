import { TRACKED_STATUSES } from "@workspace/domain/tracking/statuses"

import type { MapEntity } from "@/frontend/pages/map/types"

/**
 * What the table reads off a movement's last ping. Pure, so the rows, the
 * red rule and the CSV all agree on what "stale" and "place" mean.
 */

/** A truck silent for longer than this is flagged — Claire's twelve-hour rule */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000

/** Whole hours since the last ping; null when there has never been one */
export const hoursSince = (entity: MapEntity, now: Date): number | null =>
    entity.lastPosition
        ? Math.max(0, Math.floor((now.getTime() - entity.lastPosition.recordedAt.getTime()) / 3_600_000))
        : null

/**
 * Older than twelve hours — or never heard from at all, which is worse.
 * Only for a movement the cron is pinging: tracking starts when the truck
 * leaves the loading site, so a load still parked there is never late. The
 * loads carry the order vocabulary (`movementTone`), which spells the six
 * tracked stages the same way, so one test covers both kinds.
 */
export const isStale = (entity: MapEntity, now: Date): boolean =>
    TRACKED_STATUSES.includes(entity.status)
    && (!entity.lastPosition || now.getTime() - entity.lastPosition.recordedAt.getTime() > STALE_AFTER_MS)

/**
 * The place as text: the reverse-geocoded label, else what the driver's
 * client attached to the ping, else the bare coordinates. Null without a ping.
 */
export const placeText = (entity: MapEntity): string | null => {
    const position = entity.lastPosition

    if (!position) return null

    return position.placeLabel ?? position.placeName ?? `${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`
}
