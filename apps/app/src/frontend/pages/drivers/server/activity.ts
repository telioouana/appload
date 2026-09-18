import type { ActivityCatalog } from "@workspace/trpc/activity-log";

/**
 * Display-safe params for the driver mutations (scalar whitelist, see
 * src/backend/api/activity-catalog.ts). A driver's name, email, phone and
 * passport are personal data and never travel here — only the ids and the
 * booleans that say which blocks the write carried.
 */
export const driversCatalog: ActivityCatalog = {
    "drivers.register": {
        entity: (_input, output?: { id?: string }) =>
            output?.id ? { type: "driver", id: output.id } : null,
        params: (input, output?: { id?: string }) => ({
            driverId: output?.id ?? "",
            // False means the procedure stood a placeholder address in
            hasEmail: Boolean(input?.email),
            hasPassport: Boolean(input?.passport),
        }),
    },
    "drivers.update": {
        entity: (input) => (input?.id ? { type: "driver", id: String(input.id) } : null),
        params: (input) => ({
            driverId: input?.id ?? "",
            changedName: Boolean(input?.patch?.name),
            changedEmail: Boolean(input?.patch?.email),
            changedPhone: Boolean(input?.patch?.phoneNumber),
            changedPassport: input?.patch?.passport !== undefined,
        }),
    },
};
