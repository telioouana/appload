import type { Order } from "@workspace/db/orders";

/**
 * Whether a STORED booked row already carries the driver and the truck,
 * and what is still missing. This is the bar for booked -> to-loading: a
 * trip is often booked weeks ahead of the vehicle being named, so the
 * fields are optional at booking and mandatory the moment the order is
 * dispatched to the loading site.
 *
 * Same shape as the offer check next door (./booking-readiness): pure,
 * isomorphic, guarded by the transition mutation and advertised by
 * transitionOptions, so the dialog can never offer a move the mutation
 * would refuse.
 */

export type DispatchField =
    | "truckPlate" | "truckAge"
    | "driverId" | "driverName" | "driverPhoneNumber" | "driverPassport";

// The fields themselves, plus the column the conditional rule reads
export type DispatchRow = Pick<Order, DispatchField | "route">;

// Always required before the truck is sent to load
const REQUIRED: DispatchField[] = [
    "truckPlate", "truckAge",
    "driverId", "driverName", "driverPhoneNumber",
];

const isMissing = (value: unknown) => value === undefined || value === null || value === "";

/** The still-missing fields, in form order — empty means ready to dispatch. */
export function missingForDispatch(row: DispatchRow): DispatchField[] {
    const missing = REQUIRED.filter((field) => isMissing(row[field]));

    // The passport only crosses a border on regional trips
    if (row.route === "regional" && isMissing(row.driverPassport)) {
        missing.push("driverPassport");
    }

    return missing;
}

/** The same verdict as a boolean, for guards that don't report the gaps. */
export function isReadyToDispatch(row: DispatchRow): boolean {
    return missingForDispatch(row).length === 0;
}
