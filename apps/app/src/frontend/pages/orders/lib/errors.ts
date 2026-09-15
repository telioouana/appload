import { domainErrorCode } from "@workspace/trpc/errors"

/**
 * Every domain code the orders procedures (and the shared door behind them)
 * can raise, mapped to the message key that explains it. One table, so a
 * toast, a dialog alert and a form field all say the same thing about the
 * same failure.
 */
export const ORDER_ERROR_KEYS = {
    // Optimistic lock and actor policy
    VERSION_CONFLICT: "versionConflict",
    NOT_ALLOWED_FOR_ACTOR: "notAllowedForActor",
    NOT_ALLOWED: "notAllowed",
    NOT_FOUND: "notFound",
    WRONG_ORGANIZATION_TYPE: "notAllowed",
    SUBSCRIPTION_REQUIRED: "subscriptionRequired",
    QUOTA_EXCEEDED: "quotaExceeded",
    // Transition requirements
    NOTE_REQUIRED: "noteRequired",
    POD_REQUIRED: "podRequired",
    EVIDENCE_REQUIRED: "evidenceRequired",
    INCOMPLETE_FOR_DISPATCH: "incompleteForDispatch",
    DISPATCH_REQUIRED: "dispatchRequired",
    PAPERS_MISSING: "papersMissing",
    DISPUTE_OPEN: "disputeOpen",
    // Dispatch: an id that is not this carrier's own
    DRIVER_NOT_REGISTERED: "driverNotRegistered",
    TRUCK_NOT_REGISTERED: "truckNotRegistered",
    TRAILER_NOT_REGISTERED: "trailerNotRegistered",
    LINK_NOT_REGISTERED: "linkNotRegistered",
    // Documents
    INVALID_DOCUMENT_URL: "invalidDocumentUrl",
    UPLOAD_FAILED: "uploadFailed",
    // Requests and offers
    ORDER_NOT_PROSPECT: "orderNotProspect",
    CARRIER_NOT_CONNECTED: "carrierNotConnected",
    NOT_REQUESTED: "notRequested",
    OFFER_EXISTS: "offerExists",
    OFFER_NOT_PENDING: "offerNotPending",
    OFFER_UNPRICED: "offerUnpriced",
    OFFER_REQUIRED: "offerRequired",
    // Appload's verification gate, raised when a booking commits the cargo
    CARRIER_NOT_VERIFIED: "carrierNotVerified",
    CARRIER_CONTRACT_MISSING: "carrierContractMissing",
    CARRIER_CONTRACT_EXPIRED: "carrierContractExpired",
    CARRIER_SUSPENDED: "carrierSuspended",
    RISK_REVIEW_REQUIRED: "riskReview",
    INVALID: "invalid",
    UNKNOWN: "unknown",
} as const

export type OrderErrorCode = keyof typeof ORDER_ERROR_KEYS

/** The message keys under `App.orders.errors`, as a union the translator accepts. */
export type OrderErrorMessage = (typeof ORDER_ERROR_KEYS)[OrderErrorCode]

export const ORDER_ERROR_CODES = Object.keys(ORDER_ERROR_KEYS) as OrderErrorCode[]

/** The domain code an error carries, narrowed to the ones with an explanation. */
export const orderErrorCode = (error: unknown): OrderErrorCode =>
    domainErrorCode(error, ORDER_ERROR_CODES, "UNKNOWN")

/** The message key under `App.orders.errors` for whatever went wrong. */
export const orderErrorKey = (error: unknown) => ORDER_ERROR_KEYS[orderErrorCode(error)]
