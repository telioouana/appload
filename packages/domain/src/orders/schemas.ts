import { z } from "zod"

import type { Order, OrderOffer } from "@workspace/db/orders";
import { CATEGORIES, CURRENCY, FISCAL_REGIME, INSURANCE_PAYMENT_STATUS, INSURANCE_SUBSCRIBER, LOAD_TYPE, LOADING_BAY, ORDER_STATUS, PACKING, PAYMENT_STATUS, POD_STATUS, ROUTE_TYPE, TRIP_TYPE, TRUCK_AGE, WEIGHT_UNIT, } from "@workspace/db/types";

import { priceOffer } from "@workspace/domain/orders/commission";

import { offerInput } from "@workspace/domain/orders/offer-schemas";

export type ErrorParam = { error: string } | undefined;
export type ErrorMessage = "address" | "carrier" | "category" | "contact" | "count" | "currency" | "date" | "days" | "deliveries" | "description" | "driver" | "field" | "list" | "passport" | "percentage" | "plate" | "shipper" | "subtotal" | "total" | "status" | "value" | "weight" | "offers" | "accepted"

// DecimalInput keeps amounts as strings while typing ("12.5"); convert to
// numbers before validation and treat empty strings as missing
const toNumber = (value: unknown) => {
    if (value === "" || value === null || value === undefined) {
        return undefined;
    }

    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? value : parsed;
    }

    return value;
};

const requiredAmount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).nonnegative(error));
const optionalAmount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).nonnegative(error).optional());
const optionalCount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).int(error).nonnegative(error).optional());
const optionalPercentage = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).min(0, error).max(100, error).optional());

// Shape stored in the jsonb address columns (see Location in @workspace/db)
const location = (error?: ErrorParam) => z.object({
    address: z.string().nonempty(error),
    placeId: z.string().nonempty(),
    country: z.string().nonempty(),
    state: z.string().nonempty(),
});

const isMissing = (value: unknown) => value === undefined || value === null || value === "";

/**
 * The create-shaped payload, shared by creation and by the full edit of a
 * prospect (order.updateDeal).
 *
 * An order carries no carrier of its own: it carries carrier OFFERS, and
 * booking one copies its carrier, fiscal regime and price onto the order.
 * So the only thing @status = "booked" demands here is an offer marked
 * accepted (see the superRefine below) — the driver and the truck are the
 * dispatch gate's business (@/lib/orders/dispatch-readiness) and stay
 * optional at every status, because a trip is often booked weeks before
 * the rig that will run it is known.
 */
export function create(message: (field: ErrorMessage) => ErrorParam) {
    return (
        z.object({
            shipperId: z.uuid(),
            shipperName: z.string().nonempty(message("shipper")),
            status: z.enum(["prospect", "booked"], message("status")),

            loadingAddress: z.object({
                address: z.string().nonempty(message("address")),
                placeId: z.string().nonempty(),
                country: z.string().nonempty(),
                state: z.string().nonempty(),
            }),
            expectedLoadingDate: z.date(message("date")),
            offloadingAddress: z.object({
                address: z.string().nonempty(message("address")),
                placeId: z.string().nonempty(),
                country: z.string().nonempty(),
                state: z.string().nonempty(),
            }),
            expectedOffloadingDate: z.date(message("date")).optional(),
            distance: requiredAmount(message("value")),
            deliveries: requiredAmount(message("deliveries")),
            routeType: z.enum(ROUTE_TYPE, message("field")),
            tripType: z.enum(TRIP_TYPE, message("field")),

            category: z.enum(CATEGORIES, message("list")),
            description: z.string().nonempty(message("description")),
            weight: requiredAmount(message("weight")),
            weightUnit: z.enum(WEIGHT_UNIT, message("list")),
            loadType: z.enum(LOAD_TYPE, message("list")),

            /**
             * @shipperSubtotal, @shipperVAT and @shipperTotal are kept in sync live
             * by the create-order view (watch subscription); the schema only validates them
             * Business rule applied there:
             * @shipperVAT = if @routeType = "national" then @shipperTotal * (0.16/1.16) else 0
             * @shipperSubtotal = @shipperTotal - @shipperVAT
             */
            shipperSubtotal: optionalAmount(message("subtotal")),
            shipperVAT: optionalAmount(message("value")),
            shipperTotal: optionalAmount(message("total")),
            shipperCurrency: z.enum(CURRENCY, message("currency")),

            /**
             * Insurance
             */
            insuranceSubscriber: z.enum(INSURANCE_SUBSCRIBER, message("list")).optional(),
            insuranceValue: optionalAmount(message("value")),
            insuranceCurrency: z.enum(CURRENCY, message("currency")).optional(),
            insuranceStatus: z.enum(INSURANCE_PAYMENT_STATUS, message("status")).optional(),

            /**
             * The carrier quotes that exist for this order. A prospect may
             * carry none, some or many, all awaiting a decision; @accepted
             * marks the one this payload books with, which is legal only
             * when @status = "booked" (enforced in the superRefine below).
             * Rows carrying an @id already exist in the database — the form
             * only ever holds pending offers, so a decided one never
             * travels back here.
             */
            offers: z.array(offerInput(message)).default([]),

            /**
             * Booking details. Optional at every status: they are required
             * before the dispatch to "at-loading", not before booking, and the order page
             * assigns them later.
             */
            driverId: z.uuid().optional(),
            driverName: z.string().optional(),
            driverContact: z.e164().optional(),
            driverPassport: z.string().optional(),

            truckPlate: z.string().optional(),
            linkPlate: z.string().optional(),
            trailerPlate: z.string().optional(),
            truckAge: z.enum(TRUCK_AGE).optional(),
            loadingBay: z.enum(LOADING_BAY).optional(),
            loadingCapacity: z.preprocess(toNumber, z.number(message("value")).positive(message("value")).optional()),

            /**
             * Always hidden fields that will show on summary already filled in if order is booked
             * Commission fields are derived in the transform below from the ACCEPTED offer
             * (@/lib/orders/commission), so a booking made here and one made later by
             * accepting an offer on the order page produce the same numbers:
             * @commissionTotal = @shipperTotal - the offer's total
             * @commissionVAT = if the offer's regime is "n/a" then 0 else if "normal" then @commissionTotal * (0.16/1.16) else @shipperVAT
             * @commissionSubtotal = @commissionTotal - @commissionVAT
             * @dealDate is auto-set to now when @status = "booked" and it is missing
             */
            dealDate: z.date().optional(),
            commissionSubtotal: optionalAmount(),
            commissionVAT: optionalAmount(),
            commissionTotal: optionalAmount(),
        })
            /**
             * The offer rules, in one block because the currency one has to
             * name the offending row (`offers.<i>.currency`) and only a
             * superRefine knows the index. `when` keeps it running even when
             * another field is invalid, exactly like the refines above it.
             */
            .superRefine((data, ctx) => {
                const offers = data?.offers ?? [];
                const accepted = offers.flatMap((offer, index) => (offer.accepted ? [{ offer, index }] : []));

                if (data?.status === "booked") {
                    // Booking IS the acceptance of an offer, so a booked
                    // payload without exactly one accepted offer has no
                    // carrier, no price and no commission to write
                    if (accepted.length !== 1) {
                        ctx.addIssue({
                            code: "custom",
                            path: ["offers"],
                            message: message(offers.length === 0 ? "offers" : "accepted")?.error,
                        });
                    }
                } else if (accepted.length > 0) {
                    // A prospect that already picked a winner is a booked
                    // order the payload forgot to promote
                    ctx.addIssue({ code: "custom", path: ["offers"], message: message("status")?.error });
                }

            }, { when: () => true })
            .transform((data) => {
                // Runs only after field parsing and the refinements above pass.
                // Shipper amounts arrive already computed by the UI and pass
                // through untouched; only commission and dealDate are derived
                // here, from the offer this payload books with
                const accepted = data.status === "booked"
                    ? data.offers.find((offer) => offer.accepted)
                    : undefined;

                const pricing = accepted
                    ? priceOffer({
                        carrierTotal: accepted.total,
                        fiscalRegime: accepted.fiscalRegime,
                        commissionTotal: accepted.commissionTotal,
                        route: data.routeType,
                    })
                    : undefined;

                return {
                    ...data,
                    // The accepted offer prices the order: the client price it
                    // quotes becomes the shipper leg, in the offer's currency,
                    // whatever the form carried for it before
                    ...(pricing && accepted && {
                        shipperSubtotal: pricing.clientSubtotal,
                        shipperVAT: pricing.clientVAT,
                        shipperTotal: pricing.clientTotal,
                        shipperCurrency: accepted.currency,
                    }),
                    commissionTotal: pricing?.commissionTotal,
                    commissionVAT: pricing?.commissionVAT,
                    commissionSubtotal: pricing?.commissionSubtotal,
                    dealDate: data.status === "booked" ? (data.dealDate ?? new Date()) : data.dealDate,
                };
            })
    )
}

// Server side validation form without message requirement
export const CreateOrderSchemaServer = create(() => undefined)

/**
 * Update form: maps 1:1 to the editable `order` table columns. Excluded:
 * system columns (id, legacyId, orderId, seq, year, createdBy, createdAt,
 * updatedAt), the immutable shipper identity (@shipperName/@shipperId — an
 * order never changes shipper), and every derived column computed by
 * deriveOrderFields in @/lib/orders/derive (on-time flags, days-spent
 * counters, demurrage flags, @dealDate, paid/remaining percentages).
 * Every field is optional — only the fields present in the payload are
 * updated — and provided fields are validated against their column type
 */
export function updateFields(message: (field: ErrorMessage) => ErrorParam) {
    return z.object({
        /**
         * Loading
         * @arrivalOnTimeLoading, @daysSpendLoading and @demurrageAtLoading are
         * derived server side (see @/lib/orders/derive)
         */
        loadingAddress: location(message("address")).optional(),
        expectedLoadingDate: z.date(message("date")).optional(),
        proposedLoadingDate: z.date(message("date")).optional(),
        arrivalAtLoading: z.date(message("date")).optional(),
        actualLoadingDate: z.date(message("date")).optional(),
        departureLoadingDate: z.date(message("date")).optional(),
        demurrageChargedAtLoading: z.boolean().optional(),
        demurrageChargedDaysAtLoading: optionalCount(message("days")),

        /**
         * Offloading
         * @arrivalOnTimeOffloading, @daysSpendOffloading and
         * @demurrageAtOffloading are derived server side
         */
        offloadingAddress: location(message("address")).optional(),
        expectedOffloadingDate: z.date(message("date")).optional(),
        proposedOffloadingDate: z.date(message("date")).optional(),
        arrivalAtOffloading: z.date(message("date")).optional(),
        actualOffloadingDate: z.date(message("date")).optional(),
        departureOffloadingDate: z.date(message("date")).optional(),
        demurrageChargedAtOffloading: z.boolean().optional(),
        demurrageChargedDaysAtOffloading: optionalCount(message("days")),

        /**
         * Border
         * @daysSpendAtBorder and @demurrageAtBorder are derived server side
         */
        arrivalAtBorder: z.date(message("date")).optional(),
        departureFromBorder: z.date(message("date")).optional(),
        demurrageChargedAtBorder: z.boolean().optional(),
        demurrageChargedDaysAtBorder: optionalCount(message("days")),

        /**
         * Trip & route
         * @daysSpendTraveling is derived server side
         */
        distance: optionalCount(message("value")),
        expectedTrucks: optionalCount(message("count")),
        route: z.enum(ROUTE_TYPE, message("field")).optional(),
        tripType: z.enum(TRIP_TYPE, message("field")).optional(),
        deliveries: optionalCount(message("deliveries")),

        /**
         * Cargo
         */
        category: z.enum(CATEGORIES, message("list")).optional(),
        description: z.string().nonempty(message("description")).optional(),
        weight: optionalAmount(message("weight")),
        loadedWeight: optionalAmount(message("weight")),
        offloadedWeight: optionalAmount(message("weight")),
        weightUnit: z.enum(WEIGHT_UNIT, message("list")).optional(),
        packing: z.enum(PACKING, message("list")).optional(),
        isHazardous: z.boolean().optional(),
        hazchemCode: z.string().optional(),
        isRefrigerated: z.boolean().optional(),
        // Refrigerated cargo temperatures can be negative
        temperature: z.preprocess(toNumber, z.number(message("value")).optional()),
        temperatureInstructions: z.string().optional(),
        loadType: z.enum(LOAD_TYPE, message("list")).optional(),

        /**
         * Status
         */
        status: z.enum(ORDER_STATUS, message("status")).optional(),
        podStatus: z.enum(POD_STATUS, message("list")).optional(),

        /**
         * Carrier & fleet
         */
        carrierName: z.string().nonempty(message("carrier")).optional(),
        carrierId: z.uuid().optional(),
        fiscalRegime: z.enum(FISCAL_REGIME, message("list")).optional(),
        truckPlate: z.string().nonempty(message("plate")).optional(),
        trailerPlate: z.string().optional(),
        linkPlate: z.string().optional(),
        truckAge: z.enum(TRUCK_AGE, message("list")).optional(),

        /**
         * Driver
         */
        driverName: z.string().nonempty(message("driver")).optional(),
        driverId: z.uuid().optional(),
        driverPhoneNumber: z.e164(message("contact")).optional(),
        driverPassport: z.string().optional(),

        /**
         * Carrier payment
         * @carrierPaidPercentage, @carrierRemainingAmount and
         * @carrierRemainingPercentage are derived server side from the paid
         * amount vs the total (@dealDate is also stamped server side)
         */
        carrierInvoiceNumber: z.string().optional(),
        carrierInvoiceDate: z.date(message("date")).optional(),
        carrierSubtotal: optionalAmount(message("subtotal")),
        carrierVAT: optionalAmount(message("value")),
        carrierTotal: optionalAmount(message("total")),
        carrierCurrency: z.enum(CURRENCY, message("currency")).optional(),
        carrierPaidAmount: optionalAmount(message("value")),
        carrierPaymentStatus: z.enum(PAYMENT_STATUS, message("status")).optional(),
        carrierFullPaymentDate: z.date(message("date")).optional(),

        /**
         * Insurance
         */
        insuranceSubscriber: z.enum(INSURANCE_SUBSCRIBER, message("list")).optional(),
        insuranceValue: optionalAmount(message("value")),
        insuranceCurrency: z.enum(CURRENCY, message("currency")).optional(),
        insuranceStatus: z.enum(INSURANCE_PAYMENT_STATUS, message("status")).optional(),

        /**
         * Appload commission
         */
        apploadCommissionSubtotal: optionalAmount(message("subtotal")),
        apploadCommissionVAT: optionalAmount(message("value")),
        apploadCommissionTotal: optionalAmount(message("total")),

        /**
         * Shipper payment
         * @shipperReceivedPercentage, @shipperRemainingAmount and
         * @shipperRemainingPercentage are derived server side
         */
        shipperInvoiceNumber: z.string().optional(),
        shipperInvoiceDate: z.date(message("date")).optional(),
        shipperSubtotal: optionalAmount(message("subtotal")),
        shipperVAT: optionalAmount(message("value")),
        shipperTotal: optionalAmount(message("total")),
        shipperCurrency: z.enum(CURRENCY, message("currency")).optional(),
        shipperReceivedAmount: optionalAmount(message("value")),
        shipperPaymentStatus: z.enum(PAYMENT_STATUS, message("status")).optional(),
        shipperFullPaymentDate: z.date(message("date")).optional(),

        /**
         * Incidents & delays
         */
        numberOfMechanicalFailuresStops: optionalCount(message("count")),
        totalMechanicalFailuresDelayedDays: optionalCount(message("days")),
        numberOfDocumentationIssuesStops: optionalCount(message("count")),
        totalDocumentationIssuesDelayedDays: optionalCount(message("days")),
        numberOfPoliceStops: optionalCount(message("count")),
        totalPoliceDelayedDays: optionalCount(message("days")),
        numberAccidents: optionalCount(message("count")),
        cargoDamaged: z.boolean().optional(),
        damagedPercent: optionalPercentage(message("percentage")),
        claimed: z.boolean().optional(),

        /**
         * Costs & indicators
         */
        ageFactor: optionalAmount(message("value")),
        loadFactor: optionalAmount(message("value")),
        defaultCoefficient: optionalAmount(message("value")),
        costPerKm: optionalAmount(message("value")),
        costPerUnit: optionalAmount(message("value")),
        costPerUnitKm: optionalAmount(message("value")),
        totalFuelCost: optionalAmount(message("value")),
    })
        /**
         * Cross-field rules (same pattern as create(); `when` keeps them
         * running even when other fields are invalid). The edit form submits
         * the full prefilled record, so checking the payload alone is enough:
         * - arrival at offloading is required once the order reaches it
         * - arrival at border is required while the order sits at the border
         * - leaving the border (back on route with an arrival recorded)
         *   requires the departure from border
         */
        .refine((data) => !(data?.status === "at-offloading" || data?.status === "offloading" || data?.status === "completed") || !isMissing(data?.arrivalAtOffloading), { path: ["arrivalAtOffloading"], error: message("date")?.error, when: () => true })
        .refine((data) => data?.status !== "at-border" || !isMissing(data?.arrivalAtBorder), { path: ["arrivalAtBorder"], error: message("date")?.error, when: () => true })
        .refine((data) => !(data?.status === "on-route" && !isMissing(data?.arrivalAtBorder) && isMissing(data?.departureFromBorder)), { path: ["departureFromBorder"], error: message("date")?.error, when: () => true });
}

// Server side update validation without message requirement
export const UpdateOrderSchemaServer = updateFields(() => undefined)

// Raw field values while editing (amount fields hold strings)
export type UpdateOrderFormInput = z.input<typeof UpdateOrderSchemaServer>

// Parsed values after validation (amounts are numbers)
export type UpdateOrderForm = z.infer<typeof UpdateOrderSchemaServer>

/**
 * The cross-field rules above read these dates alongside @status. A sparse
 * patch that changes only @status must carry them (when present) so the
 * server-side parse sees the same record shape the rules were written for
 */
export const PATCH_ANCHORS = ["arrivalAtOffloading", "arrivalAtBorder", "departureFromBorder"] as const;

/**
 * Prefills the edit forms from a stored row. Numeric columns stay as the
 * strings DecimalInput edits (the schema's preprocess parses them on submit);
 * null collapses to undefined so untouched optionals stay out of the patch
 */
export function orderToUpdateDefaults(row: Order): UpdateOrderFormInput {
    return {
        loadingAddress: row.loadingAddress,
        expectedLoadingDate: row.expectedLoadingDate,
        proposedLoadingDate: row.proposedLoadingDate ?? undefined,
        arrivalAtLoading: row.arrivalAtLoading ?? undefined,
        actualLoadingDate: row.actualLoadingDate ?? undefined,
        departureLoadingDate: row.departureLoadingDate ?? undefined,
        demurrageChargedAtLoading: row.demurrageChargedAtLoading ?? false,
        demurrageChargedDaysAtLoading: row.demurrageChargedDaysAtLoading ?? undefined,

        offloadingAddress: row.offloadingAddress,
        expectedOffloadingDate: row.expectedOffloadingDate ?? undefined,
        proposedOffloadingDate: row.proposedOffloadingDate ?? undefined,
        arrivalAtOffloading: row.arrivalAtOffloading ?? undefined,
        actualOffloadingDate: row.actualOffloadingDate ?? undefined,
        departureOffloadingDate: row.departureOffloadingDate ?? undefined,
        demurrageChargedAtOffloading: row.demurrageChargedAtOffloading ?? false,
        demurrageChargedDaysAtOffloading: row.demurrageChargedDaysAtOffloading ?? undefined,

        arrivalAtBorder: row.arrivalAtBorder ?? undefined,
        departureFromBorder: row.departureFromBorder ?? undefined,
        demurrageChargedAtBorder: row.demurrageChargedAtBorder ?? false,
        demurrageChargedDaysAtBorder: row.demurrageChargedDaysAtBorder ?? undefined,

        distance: row.distance ?? undefined,
        expectedTrucks: row.expectedTrucks ?? undefined,
        route: row.route,
        tripType: row.tripType,
        deliveries: row.deliveries ?? undefined,

        category: row.category,
        description: row.description,
        weight: row.weight,
        loadedWeight: row.loadedWeight ?? undefined,
        offloadedWeight: row.offloadedWeight ?? undefined,
        weightUnit: row.weightUnit,
        packing: row.packing ?? undefined,
        isHazardous: row.isHazardous ?? false,
        hazchemCode: row.hazchemCode ?? undefined,
        isRefrigerated: row.isRefrigerated ?? false,
        temperature: row.temperature ?? undefined,
        temperatureInstructions: row.temperatureInstructions ?? undefined,
        loadType: row.loadType,

        status: row.status,
        podStatus: row.podStatus ?? undefined,

        carrierName: row.carrierName ?? undefined,
        carrierId: row.carrierId ?? undefined,
        fiscalRegime: row.fiscalRegime ?? undefined,
        truckPlate: row.truckPlate ?? undefined,
        trailerPlate: row.trailerPlate ?? undefined,
        linkPlate: row.linkPlate ?? undefined,
        truckAge: row.truckAge ?? undefined,

        driverName: row.driverName ?? undefined,
        driverId: row.driverId ?? undefined,
        driverPhoneNumber: row.driverPhoneNumber ?? undefined,
        driverPassport: row.driverPassport ?? undefined,

        carrierInvoiceNumber: row.carrierInvoiceNumber ?? undefined,
        carrierInvoiceDate: row.carrierInvoiceDate ?? undefined,
        carrierSubtotal: row.carrierSubtotal ?? undefined,
        carrierVAT: row.carrierVAT ?? undefined,
        carrierTotal: row.carrierTotal ?? undefined,
        carrierCurrency: row.carrierCurrency ?? undefined,
        carrierPaidAmount: row.carrierPaidAmount ?? undefined,
        carrierPaymentStatus: row.carrierPaymentStatus ?? undefined,
        carrierFullPaymentDate: row.carrierFullPaymentDate ?? undefined,

        // Free-text column, but only ever fed from the INSURANCE_SUBSCRIBER enum
        insuranceSubscriber: (row.insuranceSubscriber ?? undefined) as (typeof INSURANCE_SUBSCRIBER)[number] | undefined,
        insuranceValue: row.insuranceValue ?? undefined,
        insuranceCurrency: row.insuranceCurrency ?? undefined,
        insuranceStatus: row.insuranceStatus ?? undefined,

        apploadCommissionSubtotal: row.apploadCommissionSubtotal ?? undefined,
        apploadCommissionVAT: row.apploadCommissionVAT ?? undefined,
        apploadCommissionTotal: row.apploadCommissionTotal ?? undefined,

        shipperInvoiceNumber: row.shipperInvoiceNumber ?? undefined,
        shipperInvoiceDate: row.shipperInvoiceDate ?? undefined,
        shipperSubtotal: row.shipperSubtotal ?? undefined,
        shipperVAT: row.shipperVAT ?? undefined,
        shipperTotal: row.shipperTotal ?? undefined,
        shipperCurrency: row.shipperCurrency ?? undefined,
        shipperReceivedAmount: row.shipperReceivedAmount ?? undefined,
        shipperPaymentStatus: row.shipperPaymentStatus ?? undefined,
        shipperFullPaymentDate: row.shipperFullPaymentDate ?? undefined,

        numberOfMechanicalFailuresStops: row.numberOfMechanicalFailuresStops ?? undefined,
        totalMechanicalFailuresDelayedDays: row.totalMechanicalFailuresDelayedDays ?? undefined,
        numberOfDocumentationIssuesStops: row.numberOfDocumentationIssuesStops ?? undefined,
        totalDocumentationIssuesDelayedDays: row.totalDocumentationIssuesDelayedDays ?? undefined,
        numberOfPoliceStops: row.numberOfPoliceStops ?? undefined,
        totalPoliceDelayedDays: row.totalPoliceDelayedDays ?? undefined,
        numberAccidents: row.numberAccidents ?? undefined,
        cargoDamaged: row.cargoDamaged ?? false,
        damagedPercent: row.damagedPercent ?? undefined,
        claimed: row.claimed ?? false,

        ageFactor: row.ageFactor ?? undefined,
        loadFactor: row.loadFactor ?? undefined,
        defaultCoefficient: row.defaultCoefficient ?? undefined,
        costPerKm: row.costPerKm ?? undefined,
        costPerUnit: row.costPerUnit ?? undefined,
        costPerUnitKm: row.costPerUnitKm ?? undefined,
        totalFuelCost: row.totalFuelCost ?? undefined,
    };
}

// Raw field values while editing (amount fields hold strings; derived fields optional)
export type CreateOrderFormInput = z.input<typeof CreateOrderSchemaServer>

// Parsed values after validation and derivation (shipper amounts are numbers)
export type CreateOrderForm = z.infer<typeof CreateOrderSchemaServer>

/**
 * Prefills the create-shaped form when EDITING a prospect. A prospect
 * reuses the create form (same schema, same booked-completeness refines)
 * so confirming it can never dodge the validation creation applies; from
 * booked onward an order edits through the tabbed patch form instead.
 * Numeric columns stay as the strings DecimalInput edits; null collapses
 * to undefined. `loadingBay` is fleet-derived and refills when the truck
 * is picked in the form.
 *
 * Only the order's PENDING offers come back into the form — a decided one
 * is the record of what happened and is not editable — and none of them
 * arrives accepted: accepting is what saving the form as booked does.
 */
export function orderToCreateDefaults(row: Order, offers: OrderOffer[]): CreateOrderFormInput {
    return {
        shipperId: row.shipperId,
        shipperName: row.shipperName,
        status: row.status as "prospect",

        loadingAddress: row.loadingAddress,
        expectedLoadingDate: row.expectedLoadingDate,
        offloadingAddress: row.offloadingAddress,
        expectedOffloadingDate: row.expectedOffloadingDate ?? undefined,
        distance: row.distance ?? undefined,
        deliveries: row.deliveries ?? undefined,
        routeType: row.route,
        tripType: row.tripType,

        category: row.category,
        description: row.description,
        weight: row.weight,
        weightUnit: row.weightUnit,
        loadType: row.loadType,

        shipperSubtotal: row.shipperSubtotal ?? undefined,
        shipperVAT: row.shipperVAT ?? undefined,
        shipperTotal: row.shipperTotal ?? undefined,
        shipperCurrency: row.shipperCurrency ?? "MZN",

        // Free-text column, but only ever fed from the INSURANCE_SUBSCRIBER enum
        insuranceSubscriber: (row.insuranceSubscriber ?? undefined) as (typeof INSURANCE_SUBSCRIBER)[number] | undefined,
        insuranceValue: row.insuranceValue ?? undefined,
        insuranceCurrency: row.insuranceCurrency ?? undefined,
        insuranceStatus: row.insuranceStatus ?? undefined,

        offers: offers
            .filter((offer) => offer.status === "pending")
            .map((offer) => ({
                id: offer.id,
                carrierId: offer.carrierId,
                carrierName: offer.carrierName,
                fiscalRegime: offer.fiscalRegime,
                subtotal: offer.subtotal ?? undefined,
                vat: offer.vat ?? undefined,
                total: offer.total,
                currency: offer.currency,
                commissionTotal: offer.commissionTotal ?? undefined,
                includesGit: offer.includesGit,
                includesGps: offer.includesGps,
                notes: offer.notes ?? undefined,
                accepted: false,
            })),

        driverId: row.driverId ?? undefined,
        driverName: row.driverName ?? undefined,
        driverContact: row.driverPhoneNumber ?? undefined,
        driverPassport: row.driverPassport ?? undefined,

        truckPlate: row.truckPlate ?? undefined,
        linkPlate: row.linkPlate ?? undefined,
        trailerPlate: row.trailerPlate ?? undefined,
        truckAge: row.truckAge ?? undefined,
        loadingBay: undefined,
        loadingCapacity: undefined,

        dealDate: row.dealDate ?? undefined,
        commissionSubtotal: row.apploadCommissionSubtotal ?? undefined,
        commissionVAT: row.apploadCommissionVAT ?? undefined,
        commissionTotal: row.apploadCommissionTotal ?? undefined,
    };
}
