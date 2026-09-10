import type { ActivityCatalog } from "@workspace/trpc/activity-log";

/**
 * Display-safe params for the orders mutations (scalar whitelist, see
 * src/backend/api/activity-catalog.ts).
 *
 * Order ids are logged on purpose: like a plate, "APPL021.26" is the business
 * identifier the row is known by, and an audit line that cannot name the order
 * is no audit line at all. Money never is — least of all the other party's —
 * and neither are notes, addresses or contact details: the log says WHAT
 * happened and to WHICH order, and the order itself says the rest.
 */
export const ordersCatalog: ActivityCatalog = {
    "orders.create": {
        entity: (_input, output?: { orderId?: string }) =>
            output?.orderId ? { type: "order", id: output.orderId } : null,
        params: (input, output?: { orderId?: string; warning?: string }) => ({
            orderId: output?.orderId ?? "",
            category: input?.category ?? "",
            routeType: input?.routeType ?? "",
            loadType: input?.loadType ?? "",
            // Which optional blocks the form carried, never their contents
            hazardous: Boolean(input?.isHazardous),
            refrigerated: Boolean(input?.isRefrigerated),
            warning: output?.warning ?? "",
        }),
    },
    "orders.sendRequests": {
        entity: (input) => (input?.orderId ? { type: "order", id: String(input.orderId) } : null),
        params: (input, output?: { sent?: number; skipped?: number }) => ({
            orderId: input?.orderId ?? "",
            // How many carriers were asked, never which — the ids belong to
            // the connection log, not to this row
            requestCount: input?.carrierOrgIds?.length ?? 0,
            sent: output?.sent ?? 0,
            skipped: output?.skipped ?? 0,
            hasMessage: Boolean(input?.message?.trim()),
        }),
    },
    "orders.withdrawRequest": {
        entity: (input) => (input?.orderId ? { type: "order", id: String(input.orderId) } : null),
        params: (input) => ({
            orderId: input?.orderId ?? "",
            carrierOrgId: input?.carrierOrgId ?? "",
        }),
    },
    "orders.cancel": {
        entity: (input) => (input?.orderId ? { type: "order", id: String(input.orderId) } : null),
        params: (input, output?: { status?: string }) => ({
            orderId: input?.orderId ?? "",
            to: output?.status ?? "cancelled",
            hasNote: Boolean(input?.note?.trim()),
        }),
    },
    "orders.transition": {
        entity: (input) => (input?.orderId ? { type: "order", id: String(input.orderId) } : null),
        params: (input, output?: { status?: string }) => ({
            orderId: input?.orderId ?? "",
            to: output?.status ?? input?.to ?? "",
            dispatched: Boolean(input?.dispatch),
            documentType: input?.document?.type ?? "",
            hasNote: Boolean(input?.note?.trim()),
        }),
    },
    "orders.documents.add": {
        entity: (input) => (input?.orderId ? { type: "order", id: String(input.orderId) } : null),
        params: (input, output?: { id?: string }) => ({
            orderId: input?.orderId ?? "",
            documentId: output?.id ?? "",
            documentType: input?.type ?? "",
        }),
    },
    "orders.offers.create": {
        entity: (input) => (input?.orderId ? { type: "order", id: String(input.orderId) } : null),
        params: (input, output?: { id?: string }) => ({
            orderId: input?.orderId ?? "",
            offerId: output?.id ?? "",
            // What the quote covers, never what it costs
            includesGit: Boolean(input?.values?.includesGit),
            includesGps: Boolean(input?.values?.includesGps),
            hasNotes: Boolean(input?.values?.notes?.trim()),
        }),
    },
    "orders.offers.update": {
        entity: (input) => (input?.offerId ? { type: "offer", id: String(input.offerId) } : null),
        params: (input) => ({
            offerId: input?.offerId ?? "",
            // Which blocks the patch carried, never their values
            repriced: input?.patch?.total !== undefined || input?.patch?.fiscalRegime !== undefined,
            changedCover: input?.patch?.includesGit !== undefined || input?.patch?.includesGps !== undefined,
        }),
    },
    "orders.offers.withdraw": {
        entity: (input) => (input?.offerId ? { type: "offer", id: String(input.offerId) } : null),
        params: (input) => ({ offerId: input?.offerId ?? "" }),
    },
    "orders.offers.accept": {
        entity: (input) => (input?.orderId ? { type: "order", id: String(input.orderId) } : null),
        params: (input, output?: { status?: string }) => ({
            orderId: input?.orderId ?? "",
            offerId: input?.offerId ?? "",
            to: output?.status ?? "booked",
        }),
    },
    "orders.offers.decline": {
        entity: (input) => (input?.offerId ? { type: "offer", id: String(input.offerId) } : null),
        params: (input) => ({
            offerId: input?.offerId ?? "",
            hasNote: Boolean(input?.note?.trim()),
        }),
    },
};
