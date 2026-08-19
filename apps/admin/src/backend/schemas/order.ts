import { z } from "zod"

import { useTranslations } from "@workspace/i18n";
import type { Order } from "@workspace/db/orders";
import { CATEGORIES, CURRENCY, FISCAL_REGIME, INSURANCE_PAYMENT_STATUS, INSURANCE_SUBSCRIBER, LOAD_TYPE, LOADING_BAY, ORDER_STATUS, PACKING, PAYMENT_STATUS, POD_STATUS, ROUTE_TYPE, TRIP_TYPE, TRUCK_AGE, WEIGHT_UNIT, } from "@workspace/db/types";

type CreateTranslations = ReturnType<typeof useTranslations<"Admin.order.create">>
type UpdateTranslations = ReturnType<typeof useTranslations<"Admin.order.update">>

type ErrorParam = { error: string } | undefined;
type ErrorMessage = "address" | "carrier" | "category" | "contact" | "count" | "currency" | "date" | "days" | "deliveries" | "description" | "driver" | "field" | "list" | "passport" | "percentage" | "plate" | "shipper" | "subtotal" | "total" | "status" | "value" | "weight"

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

// Mozambican VAT extracted from a VAT-inclusive total: total * (0.16/1.16)
const VAT_RATE = 0.16 / 1.16;
const round2 = (n: number) => Math.round(n * 100) / 100;

// The carrier section becomes required once @status = "booked" (see the
// .refine chain below). @truckAge is auto-filled from the truck profile (via
// @truckPlate) and @driverId/@driverContact from the driver profile; requiring
// them is a safety net for incomplete profiles. @driverPassport also comes from
// the driver profile but is only mandatory for regional trips
//
// The same bar over a STORED row lives in @/lib/orders/booking-readiness,
// which order.transition guards with. These refines add exactly one field:
// @loadingBay, which no order column carries — it is fleet-derived and only
// exists once a vehicle is picked here. Keep the two in step; they are not
// generated from one list because these run on form keys (@driverContact,
// @routeType) and each carries its own path and translated message.
const isMissing = (value: unknown) => value === undefined || value === null || value === "";

function create(message: (field: ErrorMessage) => ErrorParam) {
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
            shipperSubtotal: requiredAmount(message("subtotal")),
            shipperVAT: requiredAmount(message("value")),
            shipperTotal: requiredAmount(message("total")),
            shipperCurrency: z.enum(CURRENCY, message("currency")),

            /**
             * Insurance
             */
            insuranceSubscriber: z.enum(INSURANCE_SUBSCRIBER, message("list")).optional(),
            insuranceValue: optionalAmount(message("value")),
            insuranceCurrency: z.enum(CURRENCY, message("currency")).optional(),
            insuranceStatus: z.enum(INSURANCE_PAYMENT_STATUS, message("status")).optional(),

            /**
             * Validation rules for this section (enforced in the superRefine below):
             * If @status = "prospect" they are optional -> are not required to save the order
             * If @status = "booked" they are not optional -> are required to save the order
             */
            carrierId: z.uuid().optional(),
            carrierName: z.string().optional(),
            fiscalRegime: z.enum(FISCAL_REGIME).optional(),

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
             * @carrierSubtotal, @carrierVAT and @carrierTotal are kept in sync live
             * by the create-order view (watch subscription); the schema only validates them
             * Business rule applied there:
             * @carrierVAT = if @fiscalRegime = "normal" then @carrierTotal * (0.16/1.16) else 0
             * @carrierSubtotal = @carrierTotal - @carrierVAT
             */
            carrierSubtotal: optionalAmount(),
            carrierVAT: optionalAmount(),
            carrierTotal: optionalAmount(message("value")),
            carrierCurrency: z.enum(CURRENCY, message("currency")).optional(),

            /**
             * Always hidden fields that will show on summary already filled in if order is booked
             * Commission fields are derived in the transform below (only when @carrierTotal is present):
             * @commissionTotal = @shipperTotal - @carrierTotal
             * @commissionVAT = if @fiscalRegime = "n/a" then 0 else if @fiscalRegime = "normal" then @commissionTotal * (0.16/1.16) else @shipperVAT
             * @commissionSubtotal = @commissionTotal - @commissionVAT (implied by the pattern)
             * @dealDate is auto-set to now when @status = "booked" and it is missing
             */
            dealDate: z.date().optional(),
            commissionSubtotal: optionalAmount(),
            commissionVAT: optionalAmount(),
            commissionTotal: optionalAmount(),
        })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.carrierId), { path: ["carrierId"], error: message("carrier")?.error, when: () => true })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.carrierName), { path: ["carrierName"], error: message("carrier")?.error, when: () => true })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.fiscalRegime), { path: ["fiscalRegime"], error: message("list")?.error, when: () => true })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.truckPlate), { path: ["truckPlate"], error: message("plate")?.error, when: () => true })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.truckAge), { path: ["truckAge"], error: message("list")?.error, when: () => true })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.loadingBay), { path: ["loadingBay"], error: message("list")?.error, when: () => true })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.driverId), { path: ["driverId"], error: message("driver")?.error, when: () => true })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.driverName), { path: ["driverName"], error: message("driver")?.error, when: () => true })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.driverContact), { path: ["driverContact"], error: message("contact")?.error, when: () => true })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.carrierSubtotal), { path: ["carrierSubtotal"], error: message("subtotal")?.error, when: () => true })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.carrierTotal), { path: ["carrierTotal"], error: message("total")?.error, when: () => true })
            .refine((data) => data?.status !== "booked" || !isMissing(data?.carrierCurrency), { path: ["carrierCurrency"], error: message("currency")?.error, when: () => true })
            // Passport only crosses a border on regional trips
            .refine((data) => !(data?.status === "booked" && data?.routeType === "regional" && isMissing(data?.driverPassport)), { path: ["driverPassport"], error: message("passport")?.error, when: () => true })
            // Commission = shipperTotal - carrierTotal only makes sense in one currency
            .refine((data) => !(data?.carrierTotal != null && data?.carrierCurrency != null && data.carrierCurrency !== data.shipperCurrency), { path: ["carrierCurrency"], error: message("currency")?.error, when: () => true })
            .transform((data) => {
                // Runs only after field parsing and the refinements above pass.
                // Shipper/carrier amounts arrive already computed by the UI and pass
                // through untouched; only commission and dealDate are derived here
                let commissionTotal: number | undefined;
                let commissionVAT: number | undefined;
                let commissionSubtotal: number | undefined;

                // A missing fiscalRegime (only possible for prospects) falls to the
                // else branch: commissionVAT = shipperVAT
                const { carrierTotal, fiscalRegime } = data;
                if (carrierTotal != null) {
                    commissionTotal = round2(data.shipperTotal - carrierTotal);
                    commissionVAT =
                        fiscalRegime === "n/a" ? 0
                            : fiscalRegime === "normal" ? round2(commissionTotal * VAT_RATE)
                                : data.shipperVAT;
                    commissionSubtotal = round2(commissionTotal - commissionVAT);
                }

                return {
                    ...data,
                    commissionTotal,
                    commissionVAT,
                    commissionSubtotal,
                    dealDate: data.status === "booked" ? (data.dealDate ?? new Date()) : data.dealDate,
                };
            })
    )
}

// Server side validation form without message requirement
export const CreateOrderSchemaServer = create(() => undefined)

// Client side validation form with message requirement
export function CreateOrderSchema(t: CreateTranslations) {
    return create((field) => ({ error: t(`form.errors.validation.${field}`) }))
}

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
function updateFields(message: (field: ErrorMessage) => ErrorParam) {
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

// Client side update validation with translated messages (edit order form)
export function UpdateOrderSchema(t: UpdateTranslations) {
    return updateFields((field) => ({ error: t(`form.errors.validation.${field}`) }))
}

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
 */
export function orderToCreateDefaults(row: Order): CreateOrderFormInput {
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

        carrierId: row.carrierId ?? undefined,
        carrierName: row.carrierName ?? undefined,
        fiscalRegime: row.fiscalRegime ?? undefined,

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

        carrierSubtotal: row.carrierSubtotal ?? undefined,
        carrierVAT: row.carrierVAT ?? undefined,
        carrierTotal: row.carrierTotal ?? undefined,
        carrierCurrency: row.carrierCurrency ?? undefined,

        dealDate: row.dealDate ?? undefined,
        commissionSubtotal: row.apploadCommissionSubtotal ?? undefined,
        commissionVAT: row.apploadCommissionVAT ?? undefined,
        commissionTotal: row.apploadCommissionTotal ?? undefined,
    };
}
