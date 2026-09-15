import type { ActivityCatalog } from "@workspace/trpc/activity-log";

// Display-safe params for the quotes mutations (scalar whitelist, see src/backend/api/activity-catalog.ts).
// Ids, vocabulary values and "was there one" booleans only: never a price, a
// lane, a company name or the text of a note.
export const quotesCatalog: ActivityCatalog = {
    "quotes.create": {
        entity: (_input, output?: { id?: string }) =>
            output?.id ? { type: "quote", id: output.id } : null,
        params: (input, output?: { id?: string }) => ({
            quoteId: output?.id ?? "",
            clientOrgId: input?.clientOrgId ?? "",
            route: input?.route ?? "",
            currency: input?.currency ?? "",
            fiscalRegime: input?.fiscalRegime ?? "",
            includesGit: Boolean(input?.includesGit),
            includesGps: Boolean(input?.includesGps),
            // Whether the price holds to a date, never the price itself
            hasValidUntil: Boolean(input?.validUntil),
            hasNotes: Boolean(input?.notes?.trim()),
        }),
    },
    "quotes.withdraw": {
        entity: (input) => (input?.id ? { type: "quote", id: String(input.id) } : null),
        params: (input) => ({ quoteId: input?.id ?? "" }),
    },
    "quotes.decline": {
        entity: (input) => (input?.id ? { type: "quote", id: String(input.id) } : null),
        params: (input) => ({
            quoteId: input?.id ?? "",
            // Whether a reason was given, never what it said
            hasNote: Boolean(input?.note?.trim()),
        }),
    },
    "quotes.accept": {
        // The order is what the acceptance produced, and what the log links to
        entity: (_input, output?: { orderId?: string }) =>
            output?.orderId ? { type: "order", id: output.orderId } : null,
        params: (input, output?: { orderId?: string }) => ({
            quoteId: input?.id ?? "",
            orderId: output?.orderId ?? "",
            category: input?.cargo?.category ?? "",
            loadType: input?.cargo?.loadType ?? "",
            isHazardous: Boolean(input?.cargo?.isHazardous),
            isRefrigerated: Boolean(input?.cargo?.isRefrigerated),
        }),
    },
};
