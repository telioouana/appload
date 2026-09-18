import type { ActivityCatalog } from "@workspace/trpc/activity-log";

/**
 * Display-safe params for the thread mutations (scalar whitelist, see
 * src/backend/api/activity-catalog.ts).
 *
 * What was said is never logged, and neither are the attachment URLs: the
 * activity log is read by staff, and an order thread they are already a
 * party to is read in Admin's Messages page — a portal load's thread is not
 * theirs to read at all.
 */
const entity = (input?: { subjectType?: unknown; subjectId?: unknown }) =>
    input?.subjectId ? { type: String(input.subjectType ?? "order"), id: String(input.subjectId) } : null;

export const threadsCatalog: ActivityCatalog = {
    "threads.send": {
        entity,
        params: (input) => ({
            subjectType: input?.subjectType ?? "",
            subjectId: input?.subjectId ?? "",
            attachmentCount: Array.isArray(input?.attachments) ? input.attachments.length : 0,
        }),
    },
    "threads.markRead": {
        entity,
        params: (input) => ({
            subjectType: input?.subjectType ?? "",
            subjectId: input?.subjectId ?? "",
        }),
    },
};
