import type { ActivityCatalog } from "@workspace/trpc/activity-log";

/**
 * Display-safe params for the fleet mutations (scalar whitelist, see
 * src/backend/api/activity-catalog.ts).
 *
 * Registration plates are logged on purpose: like an order id, a plate is the
 * business identifier the row is known by, and an audit line that cannot name
 * the vehicle is no audit line at all. Contact details never are.
 */
export const fleetCatalog: ActivityCatalog = {
    "fleet.vehicles.register": {
        entity: (input, output?: { id?: string }) =>
            output?.id ? { type: input?.kind ?? "vehicle", id: output.id } : null,
        params: (input, output?: { id?: string; regPlate?: string }) => ({
            kind: input?.kind ?? "",
            vehicleId: output?.id ?? "",
            regPlate: output?.regPlate ?? "",
            truckType: input?.type ?? "",
            hasLoadingBay: Boolean(input?.loadingBay),
        }),
    },
    "fleet.vehicles.update": {
        entity: (input) => (input?.id ? { type: input?.kind ?? "vehicle", id: String(input.id) } : null),
        params: (input, output?: { regPlate?: string }) => ({
            kind: input?.kind ?? "",
            vehicleId: input?.id ?? "",
            regPlate: output?.regPlate ?? "",
            // Which blocks the patch carried, never their contents
            changedPlate: Boolean(input?.patch?.regPlate),
            changedIdentity: Boolean(input?.patch?.brand || input?.patch?.model || input?.patch?.year || input?.patch?.vin),
            changedLoadingBay: input?.patch?.loadingBay !== undefined,
        }),
    },
    // The KYC router lives in this folder and mounts at the root, so its
    // path is `kyc.upload` — the same one Admin's upload logs under, and
    // the same params its ActivityLog message reads. Which paper was filed
    // for which subject; never the pages themselves.
    "kyc.upload": {
        entity: (input) =>
            input?.subjectId ? { type: String(input.subjectType), id: String(input.subjectId) } : null,
        params: (input) => ({
            subjectType: input?.subjectType ?? "",
            subjectId: input?.subjectId ?? "",
            documentType: input?.type ?? "",
        }),
    },
    "fleet.assignDriver": {
        entity: (input) => (input?.driverId ? { type: "driver", id: String(input.driverId) } : null),
        params: (input) => ({
            driverId: input?.driverId ?? "",
            truckId: input?.truckId ?? "",
            // The one thing the ids do not say on their own
            unassigned: input?.truckId === null,
        }),
    },
};
