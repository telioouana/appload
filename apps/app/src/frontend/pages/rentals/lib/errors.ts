import { domainErrorCode } from "@workspace/trpc/errors"

/** The domain codes the rentals copy has a sentence for (App.rentals.errors). */
export const RENTAL_ERROR_CODES = [
    "NOT_FOUND", "NOT_ALLOWED", "VERSION_CONFLICT", "CONTRACT_CLOSED", "CLIENT_MUST_ACCEPT", "PERIOD_INVERTED",
    "PRICE_MODEL_BASIS_MISMATCH", "LINE_NEEDS_TRUCK", "TRUCK_ON_RENTAL", "LINE_HAS_LOG", "DAY_IN_FUTURE", "DAY_OUT_OF_PERIOD",
    "NOT_THE_PROVIDER", "NOT_THE_CLIENT", "AMOUNT_REQUIRED", "CORRECTION_NEEDS_REFERENCE", "LINE_REQUIRED",
    "CLIENT_IS_SELF", "CARRIER_IS_SELF", "APPLOAD_NOT_A_CLIENT", "NOT_CONNECTED", "OWN_FLEET_HAS_NO_BUY_PRICE",
    "RIG_NOT_ON_ALLOCATION", "TRUCK_NOT_REGISTERED", "DRIVER_NOT_REGISTERED", "ALLOCATION_EXISTS", "ALLOCATION_HAS_TRIPS",
    "INVALID_STATUS", "UNKNOWN",
] as const

export type RentalErrorCode = (typeof RENTAL_ERROR_CODES)[number]

export const rentalErrorKey = (error: unknown): RentalErrorCode => domainErrorCode(error, RENTAL_ERROR_CODES, "UNKNOWN")
