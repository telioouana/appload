import type { ActivityCatalog } from "@workspace/trpc/activity-log";

/**
 * Display-safe params for the movements mutations (scalar whitelist, see
 * src/backend/api/activity-catalog.ts).
 *
 * The id and the reference are logged: they are how a load is found again.
 * Nothing else about it is — no driver, no phone, no amount. The activity
 * log is read by staff about tenants, and a tenant's own books are the one
 * thing this redesign promised to keep out of Appload's reach.
 */
const entity = (input?: { id?: unknown; movementId?: unknown }) => {
    const id = input?.id ?? input?.movementId;
    return id ? { type: "movement", id: String(id) } : null;
};

export const movementsCatalog: ActivityCatalog = {
    "movements.create": {
        entity: (_input, output?: { id?: string }) => (output?.id ? { type: "movement", id: output.id } : null),
        params: (input, output?: { id?: string; ref?: string }) => ({
            movementId: output?.id ?? "",
            ref: output?.ref ?? "",
            execution: input?.execution ?? "",
            status: input?.status ?? "",
            // Which blocks were filled, never their contents
            withClient: Boolean(input?.clientOrgId || input?.clientName),
            withCarrier: Boolean(input?.carrierOrgId || input?.carrierName),
            priced: Boolean(input?.sell || input?.buy),
        }),
    },
    "movements.update": {
        entity,
        params: (input) => ({ movementId: input?.id ?? "" }),
    },
    "movements.transition": {
        entity,
        params: (input, output?: { status?: string }) => ({
            movementId: input?.id ?? "",
            to: output?.status ?? input?.to ?? "",
        }),
    },
    "movements.offer": {
        entity,
        params: (input) => ({ movementId: input?.id ?? "" }),
    },
    "movements.withdraw": {
        entity,
        params: (input) => ({ movementId: input?.id ?? "" }),
    },
    "movements.respond": {
        entity,
        params: (input) => ({ movementId: input?.id ?? "", decision: input?.decision ?? "" }),
    },
    "movements.convert": {
        entity,
        params: (input) => ({ movementId: input?.id ?? "", to: input?.to ?? "" }),
    },
    "movements.recordPayment": {
        entity,
        params: (input) => ({ movementId: input?.id ?? "", leg: input?.leg ?? "" }),
    },
    "movements.costs.add": {
        entity,
        params: (input) => ({ movementId: input?.movementId ?? "", kind: input?.kind ?? "" }),
    },
    "movements.costs.remove": {
        params: (input) => ({ costId: input?.id ?? "" }),
    },
    "movements.documents.add": {
        entity,
        params: (input) => ({ movementId: input?.movementId ?? "", type: input?.type ?? "", leg: input?.leg ?? "" }),
    },
    "movements.documents.remove": {
        params: (input) => ({ documentId: input?.id ?? "" }),
    },
    "movements.requestLocation": {
        entity,
        params: (input, output?: { sent?: boolean; mode?: string }) => ({
            movementId: input?.id ?? "",
            sent: Boolean(output?.sent),
            mode: output?.mode ?? "",
        }),
    },
};
