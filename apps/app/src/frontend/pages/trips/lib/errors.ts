import { domainErrorCode } from "@workspace/trpc/errors"

/**
 * Every domain code the trips procedures raise, mapped to the message key
 * that explains it. One table, so a toast, a dialog alert and a panel all
 * say the same thing about the same failure.
 */
export const TRIP_ERROR_KEYS = {
    NOT_FOUND: "notFound",
    NOT_ALLOWED: "notAllowed",
    NOT_ALLOWED_FOR_ACTOR: "notAllowed",
    // The partner named on the trip is not (or is no longer) connected
    PARTNER_NOT_CONNECTED: "partnerNotConnected",
    // The move is not one the trip's current status allows
    INVALID_STATUS: "invalidStatus",
    TRIP_CLOSED: "tripClosed",
    // Asking a driver where they are only makes sense while they are driving
    TRIP_NOT_IN_TRANSIT: "notInTransit",
    // Too many manual location requests: every one is a real message to a
    // real phone, so the button is metered per trip and per company
    RATE_LIMITED: "rateLimited",
    INVALID_PHONE: "invalidPhone",
    // The plan gate in front of everything that starts tracking
    SUBSCRIPTION_REQUIRED: "subscriptionRequired",
    QUOTA_EXCEEDED: "quotaExceeded",
    // WhatsApp is not wired up on this deployment
    INFOBIP_NOT_CONFIGURED: "infobipNotConfigured",
    UNKNOWN: "unknown",
} as const

export type TripErrorCode = keyof typeof TRIP_ERROR_KEYS

/** The message keys under `App.trips.errors`, as a union the translator accepts. */
export type TripErrorMessage = (typeof TRIP_ERROR_KEYS)[TripErrorCode]

export const TRIP_ERROR_CODES = Object.keys(TRIP_ERROR_KEYS) as TripErrorCode[]

/** The domain code an error carries, narrowed to the ones with an explanation. */
export const tripErrorCode = (error: unknown): TripErrorCode =>
    domainErrorCode(error, TRIP_ERROR_CODES, "UNKNOWN")

/** The message key under `App.trips.errors` for whatever went wrong. */
export const tripErrorKey = (error: unknown) => TRIP_ERROR_KEYS[tripErrorCode(error)]
