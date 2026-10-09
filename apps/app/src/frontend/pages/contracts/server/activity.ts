import type { ActivityCatalog } from "@workspace/trpc/activity-log";

/**
 * Display-safe params for the contracts mutations (scalar whitelist, see
 * src/backend/api/activity-catalog.ts). The id and the reference only: a
 * contract's client, quantities and prices are the most private thing a
 * company keeps here, and the log is read by staff.
 */
const entity = (input?: { id?: unknown; contractId?: unknown }) => {
    const id = input?.id ?? input?.contractId;
    return id ? { type: "contract", id: String(id) } : null;
};

export const contractsCatalog: ActivityCatalog = {
    "contracts.create": {
        entity: (_input, output?: { id?: string }) => (output?.id ? { type: "contract", id: output.id } : null),
        params: (input, output?: { id?: string; ref?: string }) => ({
            contractId: output?.id ?? "",
            ref: output?.ref ?? "",
            basis: input?.basis ?? "",
            withClient: Boolean(input?.clientOrgId || input?.clientName),
        }),
    },
    "contracts.update": { entity, params: (input) => ({ contractId: input?.id ?? "" }) },
    "contracts.transition": {
        entity,
        params: (input, output?: { status?: string }) => ({ contractId: input?.id ?? "", to: output?.status ?? input?.to ?? "" }),
    },
    "contracts.setFile": { entity, params: (input) => ({ contractId: input?.id ?? "", removed: input?.url === null }) },
    "contracts.allocations.add": {
        entity,
        params: (input, output?: { id?: string }) => ({
            contractId: input?.contractId ?? "",
            allocationId: output?.id ?? "",
            ownFleet: !input?.carrierOrgId && !input?.carrierName,
        }),
    },
    "contracts.allocations.update": {
        entity: (input?: { id?: unknown }) => (input?.id ? { type: "contract_allocation", id: String(input.id) } : null),
        params: (input) => ({ allocationId: input?.id ?? "" }),
    },
    "contracts.allocations.remove": {
        entity: (input?: { id?: unknown }) => (input?.id ? { type: "contract_allocation", id: String(input.id) } : null),
        params: (input) => ({ allocationId: input?.id ?? "" }),
    },
};
