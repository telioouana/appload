import type { ActivityCatalog } from "@workspace/trpc/activity-log";

/**
 * Display-safe params for the rentals mutations (scalar whitelist, see
 * src/backend/api/activity-catalog.ts). Ids and references only: who rents
 * what from whom at what price is the most private thing a company keeps
 * here, and the log is read by staff.
 */
const order = (input?: { id?: unknown; contractId?: unknown }) => {
    const id = input?.id ?? input?.contractId;
    return id ? { type: "contract", id: String(id) } : null;
};

const line = (input?: { id?: unknown; allocationId?: unknown }) => {
    const id = input?.id ?? input?.allocationId;
    return id ? { type: "contract_allocation", id: String(id) } : null;
};

export const rentalsCatalog: ActivityCatalog = {
    "rentals.create": {
        entity: (_input, output?: { id?: string }) => (output?.id ? { type: "contract", id: output.id } : null),
        params: (input, output?: { id?: string; ref?: string }) => ({
            contractId: output?.id ?? "",
            ref: output?.ref ?? "",
            lines: Array.isArray(input?.lines) ? input.lines.length : 0,
            withClient: Boolean(input?.clientOrgId || input?.clientName),
        }),
    },
    "rentals.update": { entity: order, params: (input) => ({ contractId: input?.id ?? "" }) },
    "rentals.transition": {
        entity: order,
        params: (input, output?: { status?: string }) => ({ contractId: input?.id ?? "", to: output?.status ?? input?.to ?? "" }),
    },
    "rentals.lines.add": {
        entity: order,
        params: (input, output?: { id?: string }) => ({ contractId: input?.contractId ?? "", allocationId: output?.id ?? "", ownFleet: !input?.carrierOrgId && !input?.carrierName }),
    },
    "rentals.lines.end": { entity: line, params: (input) => ({ allocationId: input?.id ?? "", endsOn: input?.endsOn ?? "" }) },
    "rentals.lines.remove": { entity: line, params: (input) => ({ allocationId: input?.id ?? "" }) },
    "rentals.days.mark": { entity: line, params: (input) => ({ allocationId: input?.allocationId ?? "", day: input?.day ?? "", state: input?.state ?? "" }) },
    "rentals.days.dispute": { entity: line, params: (input) => ({ allocationId: input?.allocationId ?? "", day: input?.day ?? "" }) },
    "rentals.days.settle": { entity: line, params: (input) => ({ allocationId: input?.allocationId ?? "", day: input?.day ?? "", resolution: input?.resolution ?? "" }) },
    "rentals.payments.record": {
        entity: order,
        // The amount stays out: the row names the order and the side, the page shows the money
        params: (input) => ({ contractId: input?.contractId ?? "", leg: input?.leg ?? "", correction: typeof input?.amount === "number" && input.amount < 0 }),
    },
};
