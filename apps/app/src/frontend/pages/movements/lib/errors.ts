import { domainErrorCode } from "@workspace/trpc/errors"

/**
 * Every domain code the movements procedures and doors raise, mapped to the
 * message key that explains it. One table, so a toast, a dialog alert and a
 * form all say the same thing about the same failure.
 */
export const MOVEMENT_ERROR_KEYS = {
    NOT_FOUND: "notFound",
    NOT_ALLOWED: "notAllowed",
    // Somebody else changed the load since this page read it
    VERSION_CONFLICT: "versionConflict",
    OFFER_CHANGED: "versionConflict",
    INVALID_STATUS: "invalidStatus",
    MOVEMENT_CLOSED: "closed",
    FIELD_LOCKED: "fieldLocked",
    ALREADY_THAT_SHAPE: "invalidStatus",
    // Who the load is for or who moves it
    PARTNER_NOT_CONNECTED: "partnerNotConnected",
    PARTNER_NOT_ON_PORTAL: "partnerNotOnPortal",
    NOT_A_CARRIER: "notACarrier",
    OWN_FLEET_HAS_NO_CARRIER: "ownFleetHasNoCarrier",
    RIG_IS_THE_PARTNERS: "rigIsThePartners",
    EXECUTOR_DEPARTED: "executorDeparted",
    // The rig picked from the fleet is not this company's
    DRIVER_NOT_REGISTERED: "rigNotRegistered",
    TRUCK_NOT_REGISTERED: "rigNotRegistered",
    TRAILER_NOT_REGISTERED: "rigNotRegistered",
    LINK_NOT_REGISTERED: "rigNotRegistered",
    // The two moves that cannot be taken at all (status.ts). Everything else
    // a load lacks is a flag the user may proceed past, not an error
    NOTE_REQUIRED: "noteRequired",
    UNSETTLED: "unsettled",
    // What an offer to a partner on the portal still insists on (offer.ts),
    // and what asking a driver where they are needs (requestLocation)
    NO_CARRIER: "noCarrier",
    NO_PRICE: "noPrice",
    NO_DRIVER: "noDriver",
    // Money
    NO_SUCH_LEG: "noSuchLeg",
    LEG_HAS_PAYMENTS: "legHasPayments",
    PAYMENT_BELOW_ZERO: "paymentBelowZero",
    CORRECTION_NEEDS_REFERENCE: "correctionNeedsReference",
    COST_NOT_FOUND: "notFound",
    INVALID_DOCUMENT_URL: "invalidDocument",
    // Tracking
    NOT_TRACKABLE: "notTrackable",
    RATE_LIMITED: "rateLimited",
    INFOBIP_NOT_CONFIGURED: "infobipNotConfigured",
    // The plan gate in front of everything that starts tracking
    SUBSCRIPTION_REQUIRED: "subscriptionRequired",
    QUOTA_EXCEEDED: "quotaExceeded",
    UNKNOWN: "unknown",
} as const

export type MovementErrorCode = keyof typeof MOVEMENT_ERROR_KEYS

/** The message keys under `App.loads.errors`, as a union the translator accepts. */
export type MovementErrorMessage = (typeof MOVEMENT_ERROR_KEYS)[MovementErrorCode]

const MOVEMENT_ERROR_CODES = Object.keys(MOVEMENT_ERROR_KEYS) as MovementErrorCode[]

/** The message key under `App.loads.errors` for whatever went wrong. */
export const movementErrorKey = (error: unknown): MovementErrorMessage =>
    MOVEMENT_ERROR_KEYS[domainErrorCode(error, MOVEMENT_ERROR_CODES, "UNKNOWN")]
