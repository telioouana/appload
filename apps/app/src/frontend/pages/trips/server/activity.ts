import type { ActivityCatalog } from "@workspace/trpc/activity-log";

/**
 * Display-safe params for the trips mutations (scalar whitelist, see
 * src/backend/api/activity-catalog.ts).
 *
 * The reference is logged on purpose: "TRP-42" is the business identifier
 * the movement is known by, and an audit line that cannot name the trip is
 * no audit line at all. The driver never is: a name and a phone number are
 * contact details, and the trip itself already holds them.
 */
export const tripsCatalog: ActivityCatalog = {
    "trips.create": {
        entity: (_input, output?: { id?: string }) =>
            output?.id ? { type: "trip", id: output.id } : null,
        params: (input, output?: { id?: string; ref?: string }) => ({
            tripId: output?.id ?? "",
            ref: output?.ref ?? "",
            // Whether the movement started on the spot — the half that costs
            // the month a tracked movement
            startNow: Boolean(input?.startNow),
            withPartner: Boolean(input?.counterpartyOrgId),
            hasPlate: Boolean(input?.truckPlate?.trim()),
            hasExpectedDelivery: Boolean(input?.expectedDeliveryAt),
        }),
    },
    "trips.update": {
        entity: (input) => (input?.id ? { type: "trip", id: String(input.id) } : null),
        params: (input) => ({
            tripId: input?.id ?? "",
            // Which blocks the patch carried, never their values
            changedDriver: input?.driverName !== undefined || input?.driverPhone !== undefined,
            changedRoute: input?.origin !== undefined || input?.destination !== undefined,
            changedPartner: input?.counterpartyOrgId !== undefined,
        }),
    },
    "trips.setStatus": {
        entity: (input) => (input?.id ? { type: "trip", id: String(input.id) } : null),
        params: (input, output?: { status?: string }) => ({
            tripId: input?.id ?? "",
            to: output?.status ?? input?.to ?? "",
        }),
    },
    "trips.requestLocation": {
        entity: (input) => (input?.id ? { type: "trip", id: String(input.id) } : null),
        params: (input, output?: { sent?: boolean; mode?: string }) => ({
            tripId: input?.id ?? "",
            sent: Boolean(output?.sent),
            mode: output?.mode ?? "",
        }),
    },
};
