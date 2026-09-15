/**
 * The offer payloads live in @workspace/domain (both apps parse the same
 * shapes). Re-exported here so the existing Admin imports keep resolving
 * through this module; the translated wrapper is built at the call site
 * from `offerValues`, which takes the message callback.
 */
export { offerValues, offerInput, OfferValuesSchemaServer, OfferDecisionSchema } from "@workspace/domain/orders/offer-schemas";

export type { OfferValues, OfferValuesFormInput } from "@workspace/domain/orders/offer-schemas";
