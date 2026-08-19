import type { Order } from "@workspace/db/orders";

/**
 * Whether a STORED prospect row already carries everything booking demands,
 * and what is still missing. Pure and isomorphic like ./transitions: the
 * transition mutation guards with it and transitionOptions advertises with
 * it, so the dialog can never offer a move the mutation would refuse.
 *
 * This is the *stored-row* bar. The deal form (CreateOrderSchema in
 * @/backend/schemas/order) enforces one field more — `loadingBay` — and the
 * gap is deliberate: no order column carries a bay type. It lives on the
 * fleet registry, the form refills it when the truck or trailer is picked,
 * and the server re-derives it (lookupLoadingBay) whenever a PDF needs one.
 * Checking it here would mark every stored prospect permanently incomplete.
 * The form's extra refine is a document requirement at the moment it
 * generates the transport orders, not a data requirement of the deal.
 */

export type BookingField =
    | "carrierId" | "carrierName" | "fiscalRegime"
    | "truckPlate" | "truckAge"
    | "driverId" | "driverName" | "driverPhoneNumber" | "driverPassport"
    | "carrierSubtotal" | "carrierTotal" | "carrierCurrency";

// The fields themselves, plus the two columns the conditional rules read
export type BookingRow = Pick<Order, BookingField | "route" | "shipperCurrency">;

// Always required once the cargo is committed to a carrier
const REQUIRED: BookingField[] = [
    "carrierId", "carrierName", "fiscalRegime",
    "truckPlate", "truckAge",
    "driverId", "driverName", "driverPhoneNumber",
    "carrierSubtotal", "carrierTotal", "carrierCurrency",
];

const isMissing = (value: unknown) => value === undefined || value === null || value === "";

/** The still-missing fields, in form order — empty means ready to book. */
export function missingForBooking(row: BookingRow): BookingField[] {
    const missing = REQUIRED.filter((field) => isMissing(row[field]));

    // The passport only crosses a border on regional trips
    if (row.route === "regional" && isMissing(row.driverPassport)) {
        missing.push("driverPassport");
    }

    // Commission = shipperTotal - carrierTotal only makes sense in one
    // currency. carrier_currency is DB-defaulted to MZN, so the presence
    // check above rarely bites — this one does.
    if (!isMissing(row.carrierCurrency) && row.carrierCurrency !== row.shipperCurrency) {
        missing.push("carrierCurrency");
    }

    return missing;
}

/** The same verdict as a boolean, for guards that don't report the gaps. */
export function isReadyToBook(row: BookingRow): boolean {
    return missingForBooking(row).length === 0;
}
