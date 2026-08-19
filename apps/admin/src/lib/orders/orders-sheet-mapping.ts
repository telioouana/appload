import type { DocumentParty, NoteReason, Order } from "@workspace/db/orders";

import { OrderError } from "./errors";

/**
 * The "DATABASE LOGBOOK" spreadsheet keeps every order in one Google Sheets
 * Table named ORDERS (tab ORDERS, header on row 2, one row per Order Id).
 * Roughly a third of its columns are per-row formulas (on-time flags,
 * invoice subtotal/VAT, paid/remaining amounts, commission, factors), the
 * rest are data the app owns.
 *
 * Columns are resolved BY HEADER NAME at sync time (the sheet may gain or
 * reorder columns), and the app only ever writes the columns listed in
 * OWNED_COLUMNS — a formula cell is never overwritten (see sheet-outbox).
 * Dropdown-typed columns carry the exact labels of the sheet's dropdowns.
 */

export const SHEET_NAME = "ORDERS";
export const TABLE_NAME = "ORDERS";
export const HEADER_ROW = 2;

export const normalize = (header: string) => header.trim().replace(/\s+/g, " ").toLowerCase();

/** A cell to write: "" clears, null is skipped by the Sheets API (cell untouched). */
export type Cell = string | null;

/** Net debit/credit note position of one party, from the live note rows. */
export type NoteBlock = {
    kind: "Debit" | "Credit" | null;
    /** The single live reason, or null when there is none or more than one */
    reason: NoteReason | null;
    subtotal: number | null;
    vat: number | null;
    total: number | null;
};

export type SheetCellOptions = {
    /**
     * Legs whose paid block is derived from proofs of payment. Their
     * "Full Payment Date" is owned by the app, not the accountant, so a
     * cleared date (proof voided, leg no longer completed) is written as ""
     * — the one deliberate exception to the never-blank rule of the
     * hand-entered accounting cells.
     */
    popGovernedParties?: ReadonlySet<DocumentParty>;
    notes?: Partial<Record<DocumentParty, NoteBlock>>;
};

// ---------------------------------------------------------------------------
// Dropdown labels (must match the sheet's data-validation lists verbatim)

const STATUS_LABELS: Record<Order["status"], string> = {
    "prospect": "Prospects",
    "booked": "Booked",
    "to-loading": "To Loading",
    "at-loading": "At Loading",
    "loading": "Loading",
    "waiting-documents": "Waiting Documents",
    "on-route": "In Transit",
    "stopped": "Stopped",
    "issue": "Issue",
    "at-border": "At Border",
    "at-offloading": "At Offloading",
    "offloading": "Offloading",
    "delivered": "Delivered",
    "completed": "Completed",
    "cancelled": "Cancelled",
    "underbid": "Underbid",
};

const POD_STATUS_LABELS: Record<NonNullable<Order["podStatus"]>, string> = {
    "pending-collection": "Pending Collection",
    "pending-delivery": "Pending Delivery",
    "delivered": "Delivered",
    "verified": "Verified",
};

const ROUTE_LABELS: Record<Order["route"], string> = {
    "national": "National",
    "regional": "Regional",
};

const TRIP_TYPE_LABELS: Record<Order["tripType"], string> = {
    "normal": "Normal",
    "backload": "Backload",
};

const LOAD_TYPE_LABELS: Record<Order["loadType"], string> = {
    "dedicated": "Dedicated",
    "groupage": "Groupage",
};

const TRUCK_AGE_LABELS: Record<NonNullable<Order["truckAge"]>, string> = {
    "recent": "Recent",
    "not-recent": "Non recent",
};

const CATEGORY_LABELS: Record<Order["category"], string> = {
    "agriculture-inputs": "Agricultural Inputs",
    "agriculture-products": "Agricultural Products",
    "construction": "Construction Materials",
    "machinery-equipment": "Machinery & Equipment",
    "mining": "Mining & Minerals",
    "oil-gas": "Oil & Gas",
    "fmcg": "FMCG (Fast-Moving Consumer Goods)",
    "medicine": "Pharmaceuticals & Medical Supplies",
    "general-cargo": "General Cargo",
    "vehicles": "Vehicles & Automotive",
    "other": "Other",
};

const PACKING_LABELS: Record<NonNullable<Order["packing"]>, string> = {
    "bags-1kg": "Bag (1 kg)",
    "bags-2kg": "Bag (2 kg)",
    "bags-5kg": "Bag (5 kg)",
    "bags-25kg": "Bag (25 kg)",
    "bags-30kg": "Bag (30 kg)",
    "bags-50kg": "Bag (50 kg)",
    "bags-100kg": "Bag (100 kg)",
    "bags-1ton": "Bag (1 Ton)",
    "bottle-1l": "Bottle (1 L)",
    "bottle-5l": "Bottle (5 L)",
    "bottle-10l": "Bottle (10 L)",
    "bottle-20l": "Bottle (20 L)",
    "bottle-25l": "Bottle (25 L)",
    "container-20ft": "20ft Container",
    "container-40ft": "40ft Container",
    "boxes": "Boxes",
    "pallets": "Pallets",
    "noPacking": "No Packing",
    "other": "Other",
};

// The sheet uses the VAT percentage as the regime label
const FISCAL_REGIME_LABELS: Record<NonNullable<Order["fiscalRegime"]>, string> = {
    "normal": "16%",
    "simplified-5": "5%",
    "simplified-3": "3%",
    "n/a": "N/A",
};

const PAYMENT_STATUS_LABELS: Record<NonNullable<Order["carrierPaymentStatus"]>, string> = {
    "pending": "Pending",
    "partially": "Partially",
    "completed": "Completed",
    "not-applicable": "Not Applicable",
};

// Free text in the DB; the two app values map onto the dropdown, anything
// else passes through as typed
const INSURANCE_SUBSCRIBER_LABELS: Record<string, string> = {
    "appload": "Appload",
    "shipper": "Client",
};

const INSURANCE_STATUS_LABELS: Record<NonNullable<Order["insuranceStatus"]>, string> = {
    "pending": "To Be Paid",
    "paid": "Paid",
    "not-applicable": "N/A",
};

const NOTE_REASON_LABELS: Record<NoteReason, string> = {
    "demurrage": "Demurrage",
    "damage": "Cargo Damage",
    "loss-shortage": "Loss & Shortage",
    "late-delivery": "Late Delivery",
    "extra-delivery": "Extra Delivery",
    "route-deviation": "Route Deviation",
    "waiting-time": "Waiting Time",
    "tolls-fees": "Tolls & Port Fees",
    "fuel-surcharge": "Fuel Surcharge",
    "handling": "Handling",
    "storage": "Storage",
    "cleaning": "Cleaning",
    "escort-security": "Escort & Security",
    "cancellation": "Cancellation",
    "weight-variance": "Weight Variance",
    "rate-correction": "Rate Correction",
    "duplicate-invoice": "Duplicate Invoice",
    "discount": "Discount",
    "currency-adjustment": "Currency Adjustment",
    "tax-adjustment": "Tax Adjustment",
    "insurance": "Insurance",
    "extra-expenses": "Extra Expenses",
    "other": "Other",
};

// ---------------------------------------------------------------------------
// Cell formatting. Everything goes out as USER_ENTERED text, so the sheet
// parses dates/numbers/booleans itself and keeps each column's own format.

// ISO parses under any spreadsheet locale; timestamps are stored naive, so
// the calendar day is read in UTC (not the server's zone)
const date = (value: Date | null) => (value === null ? "" : value.toISOString().slice(0, 10));
const bool = (value: boolean | null) => (value === null ? "" : value ? "TRUE" : "FALSE");
const int = (value: number | null) => (value === null ? "" : String(value));
const money = (value: string | number | null) => (value === null ? "" : Number(value).toFixed(2));
const weight = (value: string | null) => (value === null ? "" : Number(value).toFixed(3));
const decimal = (value: string | null) => (value === null ? "" : String(Number(value)));
// The column is percent-formatted; the value is stored 0-100
const percent = (value: string | null) => (value === null ? "" : `${Number(value)}%`);
// The Contact column is number-formatted as a phone: digits only
const phone = (value: string | null) => (value === null ? "" : value.replace(/\D/g, ""));
const text = (value: string | null) => value ?? "";
const label = <T extends string>(map: Record<T, string>, value: T | null) => (value === null ? "" : map[value]);

type Leg = {
    party: DocumentParty;
    invoiceNumber: keyof Order;
    invoiceDate: keyof Order;
    total: keyof Order;
    currency: keyof Order;
    paymentStatus: keyof Order;
    fullPaymentDate: keyof Order;
};

const LEGS: Record<DocumentParty, Leg> = {
    carrier: {
        party: "carrier",
        invoiceNumber: "carrierInvoiceNumber",
        invoiceDate: "carrierInvoiceDate",
        total: "carrierTotal",
        currency: "carrierCurrency",
        paymentStatus: "carrierPaymentStatus",
        fullPaymentDate: "carrierFullPaymentDate",
    },
    shipper: {
        party: "shipper",
        invoiceNumber: "shipperInvoiceNumber",
        invoiceDate: "shipperInvoiceDate",
        total: "shipperTotal",
        currency: "shipperCurrency",
        paymentStatus: "shipperPaymentStatus",
        fullPaymentDate: "shipperFullPaymentDate",
    },
};

// ---------------------------------------------------------------------------
// The columns the app owns, by header text as it appears on the sheet
// ("Weight Uint", "Is Hazarduos?", "Paymement", "Insuerance" and the
// trailing space of "Loading Capacity " reproduce the sheet's spelling on
// purpose — normalize() only folds case and whitespace runs).

type OwnedColumn = {
    header: string;
    /**
     * keep: a null field leaves the cell alone (hand-entered accounting and
     * incident cells survive). Default: a null field clears the cell — the
     * app is the system of record for the rest of the row.
     */
    keep?: true;
    cell: (order: Order, options: SheetCellOptions) => Cell;
};

const leg = (party: DocumentParty): OwnedColumn[] => {
    const l = LEGS[party];
    const Party = party === "carrier" ? "Carrier" : "Shipper";
    const note = (options: SheetCellOptions) => options.notes?.[party] ?? null;

    return [
        { header: `${Party} Invoice Number`, keep: true, cell: (o) => (o[l.invoiceNumber] as string | null) ?? null },
        { header: `${Party} Invoice Date`, keep: true, cell: (o) => { const v = o[l.invoiceDate] as Date | null; return v === null ? null : date(v); } },
        // Base total only: the sheet has its own note block and derives the
        // effective amounts from it, so the booked amount stays canonical
        { header: `${Party} Invoice Total`, cell: (o) => money(o[l.total] as string | null) },
        { header: `${Party} Note`, cell: (_, opts) => note(opts)?.kind ?? "" },
        { header: `${Party} Note Reason`, cell: (_, opts) => { const n = note(opts); return n?.kind ? label(NOTE_REASON_LABELS, n.reason ?? "other") : ""; } },
        { header: `${Party} Note Subtotal`, cell: (_, opts) => { const n = note(opts); return n?.kind ? money(n.subtotal) : ""; } },
        { header: `${Party} Note VAT`, cell: (_, opts) => { const n = note(opts); return n?.kind ? money(n.vat) : ""; } },
        { header: `${Party} Note Total`, cell: (_, opts) => { const n = note(opts); return n?.kind ? money(n.total) : ""; } },
        { header: `${Party} Invoice Currency`, cell: (o) => text(o[l.currency] as string | null) },
        { header: `${Party} Paymement Status`, keep: true, cell: (o) => { const v = o[l.paymentStatus] as Order["carrierPaymentStatus"]; return v === null ? null : PAYMENT_STATUS_LABELS[v]; } },
        {
            header: `${Party} Full Payment Date`,
            keep: true,
            cell: (o, opts) => {
                const v = o[l.fullPaymentDate] as Date | null;
                if (v !== null) return date(v);
                return opts.popGovernedParties?.has(party) ? "" : null;
            },
        },
    ];
};

export const OWNED_COLUMNS: readonly OwnedColumn[] = [
    { header: "Order Id", cell: (o) => o.orderId },
    { header: "Shipper", cell: (o) => o.shipperName },
    { header: "Loading Address", cell: (o) => o.loadingAddress.address },
    { header: "Offloading Address", cell: (o) => o.offloadingAddress.address },
    { header: "Expected Loading Date", cell: (o) => date(o.expectedLoadingDate) },
    { header: "Proposed Loading Date", cell: (o) => date(o.proposedLoadingDate) },
    { header: "Arrival at Loading", cell: (o) => date(o.arrivalAtLoading) },
    { header: "Departure from Loading", cell: (o) => date(o.departureLoadingDate) },
    { header: "Demurrage at Loading", keep: true, cell: (o) => (o.demurrageAtLoading === null ? null : bool(o.demurrageAtLoading)) },
    { header: "Demurrage Charged At Loading", keep: true, cell: (o) => (o.demurrageChargedAtLoading === null ? null : bool(o.demurrageChargedAtLoading)) },
    { header: "Demurrage Charged Days At Loading", keep: true, cell: (o) => (o.demurrageChargedDaysAtLoading === null ? null : int(o.demurrageChargedDaysAtLoading)) },
    { header: "Expected Offloading Date", cell: (o) => date(o.expectedOffloadingDate) },
    { header: "Proposed Offloading Date", cell: (o) => date(o.proposedOffloadingDate) },
    { header: "Arrival at Offloading", cell: (o) => date(o.arrivalAtOffloading) },
    { header: "Departure from Offloading", cell: (o) => date(o.departureOffloadingDate) },
    { header: "Demurrage at Offloading", keep: true, cell: (o) => (o.demurrageAtOffloading === null ? null : bool(o.demurrageAtOffloading)) },
    { header: "Demurrage Charged At Offloading", keep: true, cell: (o) => (o.demurrageChargedAtOffloading === null ? null : bool(o.demurrageChargedAtOffloading)) },
    { header: "Demurrage Charged Days At Offloading", keep: true, cell: (o) => (o.demurrageChargedDaysAtOffloading === null ? null : int(o.demurrageChargedDaysAtOffloading)) },
    { header: "Arrival at Border", cell: (o) => date(o.arrivalAtBorder) },
    { header: "Departure from Border", cell: (o) => date(o.departureFromBorder) },
    { header: "Days Spent at Border", keep: true, cell: (o) => (o.daysSpendAtBorder === null ? null : int(o.daysSpendAtBorder)) },
    { header: "Demurrage at Border", keep: true, cell: (o) => (o.demurrageAtBorder === null ? null : bool(o.demurrageAtBorder)) },
    { header: "Demurrage Charged At Border", keep: true, cell: (o) => (o.demurrageChargedAtBorder === null ? null : bool(o.demurrageChargedAtBorder)) },
    { header: "Demurrage Charged Days At Border", keep: true, cell: (o) => (o.demurrageChargedDaysAtBorder === null ? null : int(o.demurrageChargedDaysAtBorder)) },
    { header: "Distance", cell: (o) => int(o.distance) },
    { header: "Route", cell: (o) => label(ROUTE_LABELS, o.route) },
    { header: "Trip Type", cell: (o) => label(TRIP_TYPE_LABELS, o.tripType) },
    { header: "Deliveries", cell: (o) => int(o.deliveries) },
    { header: "Cargo Category", cell: (o) => label(CATEGORY_LABELS, o.category) },
    { header: "Cargo Description", cell: (o) => o.description },
    { header: "Weight", cell: (o) => weight(o.weight) },
    { header: "Loaded Weight", cell: (o) => weight(o.loadedWeight) },
    { header: "Offloaded Weight", cell: (o) => weight(o.offloadedWeight) },
    { header: "Weight Uint", cell: (o) => o.weightUnit },
    { header: "Packing", cell: (o) => label(PACKING_LABELS, o.packing) },
    { header: "Is Hazarduos?", cell: (o) => bool(o.isHazardous) },
    { header: "Hazchem Code", cell: (o) => text(o.hazchemCode) },
    { header: "Is Refrigerated?", cell: (o) => bool(o.isRefrigerated) },
    { header: "Travel Temperature", cell: (o) => decimal(o.temperature) },
    { header: "Travel Temperatarute Intructions", cell: (o) => text(o.temperatureInstructions) },
    { header: "Load type", cell: (o) => label(LOAD_TYPE_LABELS, o.loadType) },
    { header: "Status", cell: (o) => STATUS_LABELS[o.status] },
    { header: "POD Status", cell: (o) => label(POD_STATUS_LABELS, o.podStatus) },
    { header: "Carrier", cell: (o) => text(o.carrierName) },
    { header: "Truck Plate", cell: (o) => text(o.truckPlate) },
    { header: "Truck Age", cell: (o) => label(TRUCK_AGE_LABELS, o.truckAge) },
    { header: "Link Plate", cell: (o) => text(o.linkPlate) },
    { header: "Trailer Plate", cell: (o) => text(o.trailerPlate) },
    { header: "Driver Name", cell: (o) => text(o.driverName) },
    { header: "Contact", cell: (o) => phone(o.driverPhoneNumber) },
    { header: "Passport", cell: (o) => text(o.driverPassport) },
    { header: "Deal Date", cell: (o) => date(o.dealDate) },
    { header: "Fiscal Regime", cell: (o) => label(FISCAL_REGIME_LABELS, o.fiscalRegime) },
    ...leg("carrier"),
    { header: "Insuerance Subscriber", cell: (o) => (o.insuranceSubscriber === null ? "" : (INSURANCE_SUBSCRIBER_LABELS[o.insuranceSubscriber] ?? o.insuranceSubscriber)) },
    { header: "Insurance Value", cell: (o) => money(o.insuranceValue) },
    { header: "Insurance Currency", cell: (o) => text(o.insuranceCurrency) },
    { header: "Insurance Status", cell: (o) => label(INSURANCE_STATUS_LABELS, o.insuranceStatus) },
    ...leg("shipper"),
    // Trip incidents and damage: hand-entered in the sheet before the app
    // existed, so a blank field never wipes what is there
    { header: "Number of Mechanical Failures Stops", keep: true, cell: (o) => (o.numberOfMechanicalFailuresStops === null ? null : int(o.numberOfMechanicalFailuresStops)) },
    { header: "Total Mechanical Failures Delayed in Days", keep: true, cell: (o) => (o.totalMechanicalFailuresDelayedDays === null ? null : int(o.totalMechanicalFailuresDelayedDays)) },
    { header: "Number of Documentation Issues Stops", keep: true, cell: (o) => (o.numberOfDocumentationIssuesStops === null ? null : int(o.numberOfDocumentationIssuesStops)) },
    { header: "Total Documentation Issues Delayed in Days", keep: true, cell: (o) => (o.totalDocumentationIssuesDelayedDays === null ? null : int(o.totalDocumentationIssuesDelayedDays)) },
    { header: "Number of Police Stops", keep: true, cell: (o) => (o.numberOfPoliceStops === null ? null : int(o.numberOfPoliceStops)) },
    { header: "Total Police Delayed in Days", keep: true, cell: (o) => (o.totalPoliceDelayedDays === null ? null : int(o.totalPoliceDelayedDays)) },
    { header: "Number of Accidents", keep: true, cell: (o) => (o.numberAccidents === null ? null : int(o.numberAccidents)) },
    { header: "Cargo Damaged?", keep: true, cell: (o) => (o.cargoDamaged === null ? null : bool(o.cargoDamaged)) },
    { header: "Damaged Percent", keep: true, cell: (o) => (o.damagedPercent === null ? null : percent(o.damagedPercent)) },
    { header: "Claimed", keep: true, cell: (o) => (o.claimed === null ? null : bool(o.claimed)) },
];

/** Header → zero-based column index for the columns the app owns, plus the row width. */
export type ResolvedColumns = {
    width: number;
    index: ReadonlyMap<string, number>;
};

/**
 * Resolves the owned columns against the sheet's header row. Refuses to
 * write when any of them is missing (someone renamed or removed a column):
 * a partial row would silently desync the logbook.
 */
export function resolveColumns(headerRow: readonly string[]): ResolvedColumns {
    const positions = new Map<string, number>();

    headerRow.forEach((header, index) => {
        const key = normalize(header);
        // First occurrence wins, mirroring what a human reading the sheet expects
        if (key && !positions.has(key)) positions.set(key, index);
    });

    const index = new Map<string, number>();
    const missing: string[] = [];

    for (const column of OWNED_COLUMNS) {
        const position = positions.get(normalize(column.header));
        if (position === undefined) {
            missing.push(column.header.trim());
        } else {
            index.set(column.header, position);
        }
    }

    if (missing.length > 0) {
        throw new OrderError("HEADER_MISMATCH", `ORDERS sheet is missing columns: ${missing.join(", ")}`);
    }

    return { width: headerRow.length, index };
}

/**
 * One full-width row of cells for the order: owned columns carry their
 * value ("" clears, null keeps the cell), every other column is null so
 * the Sheets API leaves it untouched — that is what protects the sheet's
 * formula columns on update.
 */
export function orderToSheetCells(order: Order, columns: ResolvedColumns, options: SheetCellOptions = {}): Cell[] {
    const cells: Cell[] = new Array<Cell>(columns.width).fill(null);

    for (const column of OWNED_COLUMNS) {
        const position = columns.index.get(column.header);
        if (position === undefined) continue;
        const value = column.cell(order, options);
        cells[position] = value === null && !column.keep ? "" : value;
    }

    return cells;
}

/** Zero-based column index → A1 column letters (0 → A, 26 → AA). */
export function columnLetter(index: number): string {
    let letters = "";
    let n = index + 1;

    while (n > 0) {
        const remainder = (n - 1) % 26;
        letters = String.fromCharCode(65 + remainder) + letters;
        n = Math.floor((n - 1) / 26);
    }

    return letters;
}
