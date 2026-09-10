import type { ActivityCatalog } from "@workspace/trpc/activity-log";

// Display-safe params for the partners mutations (scalar whitelist, see src/backend/api/activity-catalog.ts).
// Ids and vocabulary values only: never a company's name, address, phone or NUIT.
export const partnersCatalog: ActivityCatalog = {
    "partners.request": {
        entity: (_input, output?: { id?: string }) =>
            output?.id ? { type: "connection", id: output.id } : null,
        params: (input, output?: { id?: string }) => ({
            connectionId: output?.id ?? "",
            organizationId: input?.organizationId ?? "",
            relation: input?.relation ?? "",
            // Whether a note was attached, never what it said
            hasMessage: Boolean(input?.message?.trim()),
        }),
    },
    "partners.respond": {
        entity: (input) => (input?.id ? { type: "connection", id: String(input.id) } : null),
        params: (input) => ({
            connectionId: input?.id ?? "",
            decision: input?.decision ?? "",
        }),
    },
    "partners.remove": {
        entity: (input) => (input?.id ? { type: "connection", id: String(input.id) } : null),
        params: (input) => ({ connectionId: input?.id ?? "" }),
    },
    "partners.withdraw": {
        entity: (input) => (input?.id ? { type: "connection", id: String(input.id) } : null),
        params: (input) => ({ connectionId: input?.id ?? "" }),
    },
    "partners.register": {
        entity: (_input, output?: { organizationId?: string }) =>
            output?.organizationId ? { type: "organization", id: output.organizationId } : null,
        params: (input, output?: { organizationId?: string; connectionId?: string }) => ({
            organizationId: output?.organizationId ?? "",
            connectionId: output?.connectionId ?? "",
            relation: input?.relation ?? "",
            // Which optional blocks the form carried, never their contents
            hasEmail: Boolean(input?.email),
            hasPhysicalAddress: Boolean(input?.physicalAddress?.placeId),
        }),
    },
};
