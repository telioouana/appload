import { z } from "zod";

import { useTranslations } from "@workspace/i18n";
import { LOADING_BAY, TRUCK_TYPE } from "@workspace/db/types";

type FleetTranslator = ReturnType<typeof useTranslations<"Admin.fleet">>;

export type VehicleKind = "truck" | "trailer" | "link";

type MessageField =
    | "plate"
    | "brand"
    | "model"
    | "year"
    | "vin"
    | "type"
    | "bayValue"
    | "bayType";

type ErrorParam = { error: string } | undefined;

// DecimalInput keeps dimensions as strings while typing ("2.4"); convert to
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

// ISO 3779: 17 chars, excludes I, O and Q. The dialog input sanitizes and
// uppercases live; the regex is the final arbiter
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

const bayAmount = (error?: ErrorParam) => z.preprocess(toNumber, z.number(error).positive(error));

function buildLoadingBay(msg: (field: MessageField) => ErrorParam) {
    return z.object({
        width: bayAmount(msg("bayValue")),
        length: bayAmount(msg("bayValue")),
        height: bayAmount(msg("bayValue")),
        volume: bayAmount(msg("bayValue")),
        capacity: bayAmount(msg("bayValue")),
        type: z.enum(LOADING_BAY, msg("bayType")),
    });
}

/**
 * Registration fields shared by every fleet vehicle. Documents
 * (booklet/license) are intentionally not collected here yet.
 */
function buildBaseFields(msg: (field: MessageField) => ErrorParam) {
    return z.object({
        regPlate: z.string().nonempty(msg("plate")),
        internalId: z.string().optional(),
        brand: z.string().nonempty(msg("brand")),
        model: z.string().nonempty(msg("model")),
        year: z.preprocess(toNumber, z.number(msg("year")).int(msg("year"))),
        vin: z.string().regex(VIN_PATTERN, msg("vin")),
    });
}

/**
 * Trucks carry a `type`: articulated trucks tow the loading bay on their
 * trailer, so the bay is only required for non-articulated ones.
 */
function buildTruckSchema(msg: (field: MessageField) => ErrorParam) {
    return buildBaseFields(msg)
        .extend({
            type: z.enum(TRUCK_TYPE, msg("type")),
            loadingBay: buildLoadingBay(msg).optional(),
        })
        .refine((data) => data.type !== "non-articulated" || data.loadingBay !== undefined, {
            path: ["loadingBay", "type"],
            error: msg("bayType")?.error,
            when: () => true,
        });
}

/** Trailers and links always require the bay (their column is NOT NULL). */
function buildTowedSchema(msg: (field: MessageField) => ErrorParam) {
    return buildBaseFields(msg).extend({
        type: z.undefined().optional(),
        loadingBay: buildLoadingBay(msg),
    });
}

// Message-free variants used by the tRPC procedures to validate input
export const RegisterTruckBaseSchema = buildTruckSchema(() => undefined);
export const RegisterTrailerBaseSchema = buildTowedSchema(() => undefined);
export const RegisterLinkBaseSchema = buildTowedSchema(() => undefined);

export type RegisterTruckForm = z.infer<typeof RegisterTruckBaseSchema>;
export type RegisterTrailerForm = z.infer<typeof RegisterTrailerBaseSchema>;

// Raw field values while editing (bay dimensions hold strings)
export type RegisterVehicleFormInput = z.input<typeof RegisterTruckBaseSchema>;

// Client-side variant with translated error messages
export function RegisterVehicleSchema(kind: VehicleKind, t: FleetTranslator) {
    const msg = (field: MessageField): ErrorParam => ({ error: t(`register.errors.validation.${field}`) });

    return kind === "truck" ? buildTruckSchema(msg) : buildTowedSchema(msg);
}
