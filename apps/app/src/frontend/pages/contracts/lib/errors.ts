import { domainErrorCode } from "@workspace/trpc/errors"

/**
 * Every domain code the contracts doors raise. The message keys under
 * `App.contracts.errors` are the codes themselves, so a toast, a dialog and
 * a form all say the same thing about the same failure.
 */
export const CONTRACT_ERROR_CODES = [
    "NOT_FOUND",
    "NOT_ALLOWED",
    "VERSION_CONFLICT",
    "CONTRACT_CLOSED",
    "CONTRACT_NOT_OPEN",
    "CONTRACT_SHAPE_MISMATCH",
    "BASIS_IS_FIXED",
    "PERIOD_INVERTED",
    "QUANTITY_REQUIRED",
    "PRICE_MODEL_BASIS_MISMATCH",
    "CLIENT_IS_SELF",
    "CARRIER_IS_SELF",
    "APPLOAD_NOT_A_CLIENT",
    "NOT_CONNECTED",
    "OWN_FLEET_HAS_NO_BUY_PRICE",
    "RIG_NOT_ON_ALLOCATION",
    "TRUCK_NOT_REGISTERED",
    "DRIVER_NOT_REGISTERED",
    "ALLOCATION_EXISTS",
    "ALLOCATION_HAS_TRIPS",
    "ALLOCATION_NOT_VISIBLE",
    "INVALID_STATUS",
    "UNKNOWN",
] as const

export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[number]

/** The message key for a failed contracts call; "UNKNOWN" for anything not in the table. */
export function contractErrorKey(error: unknown): ContractErrorCode {
    return domainErrorCode(error, CONTRACT_ERROR_CODES, "UNKNOWN")
}
