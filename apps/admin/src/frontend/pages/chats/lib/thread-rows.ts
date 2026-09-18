import type { ChatMessage } from "@workspace/db/chats";

import type { ThreadItem, ThreadStatusEvent } from "@/backend/api/routers/chats";

/** Messages this close together collapse into one bubble stack. */
const GROUP_WINDOW_MS = 5 * 60_000;

export type ThreadRow =
    | { type: "divider"; key: string; date: Date }
    | { type: "status"; key: string; event: ThreadStatusEvent }
    | { type: "group"; key: string; direction: ChatMessage["direction"]; messages: ChatMessage[] };

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Whole calendar days between the given date and today (0 = today). */
export const calendarDaysAgo = (date: Date, now = new Date()) =>
    Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000);

/**
 * Folds the chronological thread into renderable rows: a divider at every
 * day boundary, status events on their own, and consecutive same-direction
 * messages within a five-minute window merged into one group. Failed sends
 * always stand alone so their error footer stays attached to them. Group
 * keys are the first message's id — stable across polls, so React reuses
 * the DOM as new messages append.
 */
export function buildThreadRows(items: ThreadItem[]): ThreadRow[] {
    const rows: ThreadRow[] = [];
    let group: Extract<ThreadRow, { type: "group" }> | null = null;
    let currentDay: string | null = null;

    for (const item of items) {
        const at = item.kind === "message" ? item.message.createdAt : item.event.createdAt;
        const day = dayKey(at);

        if (day !== currentDay) {
            currentDay = day;
            group = null;
            rows.push({ type: "divider", key: `day-${day}`, date: at });
        }

        if (item.kind === "status") {
            group = null;
            rows.push({ type: "status", key: item.event.id, event: item.event });
            continue;
        }

        const message = item.message;
        const previous = group?.messages.at(-1);
        const joins =
            group !== null
            && group.direction === message.direction
            && message.status !== "failed"
            && previous !== undefined
            && previous.status !== "failed"
            && message.createdAt.getTime() - previous.createdAt.getTime() <= GROUP_WINDOW_MS;

        if (joins && group) {
            group.messages.push(message);
        } else {
            group = { type: "group", key: message.id, direction: message.direction, messages: [message] };
            rows.push(group);
        }
    }

    return rows;
}

// The webhook flattens shared locations into "📍 place — <maps url>" bodies
// (see lib/chats/infobip.ts) — this recovers the link and the place label
const LOCATION_URL = /https:\/\/maps\.google\.com\/\?q=\S+/u;

export function parseLocation(body: string): { url: string; label: string } | null {
    const match = LOCATION_URL.exec(body);

    if (!match) {
        return null;
    }

    const label = body
        .replace(match[0], "")
        .replace(/^\s*📍\s*/u, "")
        .replace(/\s*—\s*$/u, "")
        .trim();

    return { url: match[0], label };
}
