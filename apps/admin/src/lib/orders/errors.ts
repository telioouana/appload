export const ORDER_ERROR_CODES = [
    "INVALID",
    "UNAUTHORIZED",
    "GOOGLE_NOT_LINKED",
    "INSUFFICIENT_SCOPE",
    "SHEET_FAILED",
    "HEADER_MISMATCH",
    "TRUCK_NOT_REGISTERED",
    "TRAILER_NOT_REGISTERED",
    "LINK_NOT_REGISTERED",
    "DRIVER_NOT_REGISTERED",
    "UNKNOWN",
] as const;

export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number];

export class OrderError extends Error {
    constructor(
        public readonly code: OrderErrorCode,
        message?: string,
    ) {
        super(message ?? code);
        this.name = "OrderError";
    }
}
