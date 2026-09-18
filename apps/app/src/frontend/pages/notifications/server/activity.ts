import type { ActivityCatalog } from "@workspace/trpc/activity-log";

/**
 * Display-safe params for the notifications mutations (scalar whitelist, see
 * src/backend/api/activity-catalog.ts).
 *
 * Counts only: which notifications someone read says what they were told and
 * when they looked, and the rows themselves already hold that.
 */
export const notificationsCatalog: ActivityCatalog = {
    "notifications.markRead": {
        params: (input, output?: { read?: number }) => ({
            asked: Array.isArray(input?.ids) ? input.ids.length : 0,
            // Lower than `asked` when some of them were already read
            read: output?.read ?? 0,
        }),
    },
    "notifications.markAllRead": {
        params: (_input, output?: { read?: number }) => ({ read: output?.read ?? 0 }),
    },
};
