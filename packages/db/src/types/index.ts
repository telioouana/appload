import { z } from "zod";

export const ACTIVITY_STATUS = ["success", "error"] as const
export const CURRENCY = ["MZN", "ZAR", "USD"] as const
export const TRIP_TYPE = ["backload", "normal"] as const
export const TRUCK_AGE = ["recent", "not-recent"] as const
export const WEIGHT_UNIT = ["ton", "kg", "liter"] as const
export const LOAD_TYPE = ["dedicated", "groupage"] as const
export const ROUTE_TYPE = ["national", "regional"] as const
export const MARKET_STATUS = ["pending", "completed"] as const
export const FLEET_STATUS = ["active", "idle", "free"] as const
export const SHARE = ["subscribers", "non-subscribers"] as const
export const INSURANCE_SUBSCRIBER = ["appload", "shipper"] as const
export const TRUCK_TYPE = ["articulated", "non-articulated"] as const
export const INSURANCE_PAYMENT_STATUS = ["pending", "paid", "not-applicable"] as const
export const FISCAL_REGIME = ["normal", "simplified-5", "simplified-3", "n/a"] as const
export const PAYMENT_STATUS = ["pending", "partially", "completed", "not-applicable"] as const
export const POD_STATUS = ["pending-collection", "pending-delivery", "delivered", "verified"] as const
export const LOADING_BAY = ["flatbed", "dropsides", "tautliner", "rigid-body", "refrigerated", "tipper", "side-tipper", "tanker", "lowbed"] as const
export const CATEGORIES = ["agriculture-inputs", "agriculture-products", "construction", "machinery-equipment", "fmcg", "general-cargo", "medicine", "mining", "oil-gas", "vehicles", "other"] as const
// Every value the pg enum `order_status_enum` holds, in its stored order.
// "to-loading" was retired from the vocabulary but stays here: the type
// exists in the database and dropping a value from a pg enum is not an
// additive migration. Only schemas/orders.ts reads this one.
export const ORDER_STATUS_ENUM = ["prospect", "booked", "to-loading", "at-loading", "loading", "waiting-documents", "on-route", "stopped", "issue", "at-border", "at-offloading", "offloading", "delivered", "completed", "cancelled", "underbid"] as const
// The live vocabulary: what the state machine, the filters and the selects
// iterate. The dispatch edge is booked -> at-loading, so "to-loading" is
// gone from it and only survives on historic rows.
export const ORDER_STATUS = ["prospect", "booked", "at-loading", "loading", "waiting-documents", "on-route", "stopped", "issue", "at-border", "at-offloading", "offloading", "delivered", "completed", "cancelled", "underbid"] as const
export const PACKING = ["bags-1kg", "bags-2kg", "bags-5kg", "bags-25kg", "bags-30kg", "bags-50kg", "bags-100kg", "bags-1ton", "bottle-1l", "bottle-5l", "bottle-10l", "bottle-20l", "bottle-25l", "container-20ft", "container-40ft", "boxes", "pallets", "noPacking", "other"] as const
export const YEARS = ["1981", "1982", "1983", "1984", "1985", "1986", "1987", "1988", "1989", "1990", "1991", "1992", "1993", "1994", "1995", "1996", "1997", "1998", "1999", "2000", "2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009", "2010", "2011", "2012", "2013", "2014", "2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"] as const

// The order lifecycle as a union. The tuple above stays the single source of
// truth; consumers that only need the type (map contract, tracking helpers)
// import this instead of re-deriving it.
export type OrderStatus = (typeof ORDER_STATUS)[number]

// Retired values a stored row may still carry, and what each one means
// today. Read by anything that maps `order_history` rows back onto the live
// vocabulary — the timeline, the milestones, the resume-target rule.
export const LEGACY_ORDER_STATUS_ALIAS: Record<string, OrderStatus> = {
    "to-loading": "at-loading",
}

// What one dispatched pack is made of: the driver and the pieces of the rig.
// Text + TS const like every other vocabulary here, never a pg enum.
export const ORDER_DISPATCH_SUBJECT = ["driver", "truck", "trailer", "link"] as const

// What the orderer confirms at the loading site before loading starts, and
// how the whole check came out.
export const LOADING_CHECK_ITEM = ["driver-identity", "rig-plates"] as const
export const LOADING_CHECK_OUTCOME = ["passed", "mismatch", "skipped"] as const

// What a chat thread hangs off: an Appload order, or a portal load.
export const THREAD_SUBJECT = ["order", "movement"] as const

export type OrderDispatchSubject = (typeof ORDER_DISPATCH_SUBJECT)[number]
export type LoadingCheckItem = (typeof LOADING_CHECK_ITEM)[number]
export type LoadingCheckOutcome = (typeof LOADING_CHECK_OUTCOME)[number]
export type ThreadSubject = (typeof THREAD_SUBJECT)[number]

// The subscription tiers. Declared here, with the other vocabularies, rather
// than in schemas/subscriptions.ts: `organization` carries the column and
// users.ts must keep importing nothing but this module, or the two table
// modules would reference each other and crash at runtime (TDZ). Consumers
// read it from @workspace/db/subscriptions, which re-exports it next to the
// usage table.
export const SUBSCRIPTION_PLAN = ["starter", "business", "enterprise"] as const

export type SubscriptionPlan = (typeof SUBSCRIPTION_PLAN)[number]

// Partner verification. Every KYC vocabulary is text + TS const, never a pg
// enum: adding a document type or status must not require an ALTER TYPE on
// the shared database (same rule as ORDER_DOCUMENT_TYPE).
export const KYC_SUBJECT_TYPE = ["organization", "driver", "truck", "trailer", "link"] as const
export const KYC_SUBJECT_KIND = ["shipper", "carrier", "driver", "truck", "trailer", "link"] as const
export const KYC_DOCUMENT_TYPE = [
    // organization — shippers need the first three, carriers need all of them
    "nuit",
    "id-card",
    "commercial-certificate",
    "alvara",
    "bank-letter",
    "republic-bulletin",
    "commercial-exercise",
    "signed-contract",
    // driver — "id-card" is shared with the organization set
    "driver-license",
    // trucks, trailers and links
    "vehicle-booklet",
    "proof-of-ownership",
] as const
export const KYC_DOCUMENT_STATUS = ["pending", "approved", "rejected"] as const
// "expired" is deliberately absent from the document statuses: expiry is a
// comparison against expiresAt, derived at read time so it can never drift
export const KYC_STATUS = ["draft", "pending-review", "verified", "rejected", "expired", "suspended"] as const
export const RISK_LEVEL = ["none", "watch", "high"] as const
export const OWNERSHIP_STATUS = ["unverified", "owner-verified", "third-party"] as const

export type KycSubjectType = (typeof KYC_SUBJECT_TYPE)[number]
export type KycSubjectKind = (typeof KYC_SUBJECT_KIND)[number]
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPE)[number]
export type KycDocumentStatus = (typeof KYC_DOCUMENT_STATUS)[number]
export type KycStatus = (typeof KYC_STATUS)[number]
export type RiskLevel = (typeof RISK_LEVEL)[number]
export type OwnershipStatus = (typeof OWNERSHIP_STATUS)[number]

// A document is one logical paper; its scans are the pages. Mirrors the
// Urls shape already used across the schema, plus the file metadata the
// review UI needs to render a preview without a HEAD request.
export const KycPageSchema = z.object({
    url: z.url(),
    size: z.number().int().positive().optional(),
    mimeType: z.string().optional(),
})

export const KycPagesSchema = z.array(KycPageSchema).min(1)

export type KycPage = z.infer<typeof KycPageSchema>

export const URLSchema = z.array(z.object({ url: z.url() }))

export const LoadingBaySchema = z.object({
    width: z.number().positive(),
    length: z.number().positive(),
    height: z.number().positive(),
    volume: z.number().positive(),
    capacity: z.number().positive(),
    type: z.enum(LOADING_BAY)
})

export const AddressSchema = z.object({
    address: z.string().nonempty(),
    placeId: z.string().nonempty(),
    country: z.string().nonempty(),
    state: z.string().nonempty(),
});

export type Urls = z.infer<typeof URLSchema>
export type Address = z.infer<typeof AddressSchema>
export type LoadingBay = z.infer<typeof LoadingBaySchema>
// Cargo disputes (theft, loss, damage…). Text + TS const like the KYC
// vocabularies: the dispute table and the order's mirror column store them
// as text, so growing the lists never needs an ALTER TYPE.
export const DISPUTE_REASON = ["theft", "loss", "damage", "other"] as const
export const DISPUTE_STATUS = ["open", "under-review", "settled", "closed"] as const
// open and under-review are "active": they hold payments and block closure
export const ACTIVE_DISPUTE_STATUSES = ["open", "under-review"] as const
export const DISPUTE_LIABLE_PARTY = ["carrier", "shipper", "appload", "third-party", "unknown"] as const

export type DisputeReason = (typeof DISPUTE_REASON)[number]
export type DisputeStatus = (typeof DISPUTE_STATUS)[number]
export type DisputeLiableParty = (typeof DISPUTE_LIABLE_PARTY)[number]

// Carrier offers on an order. Text + TS const like the dispute vocabularies,
// so the list can grow without an ALTER TYPE. See orderOffer in
// packages/db/src/schemas/orders.ts for what each status means.
export const OFFER_STATUS = ["pending", "accepted", "declined", "withdrawn", "lost", "recorded"] as const

export type OfferStatus = (typeof OFFER_STATUS)[number]

/** Whether a dispute in this state still holds the order: payments on hold, no completion. */
export const isActiveDispute = (status: DisputeStatus | string | null | undefined): boolean =>
    status !== null && status !== undefined && (ACTIVE_DISPUTE_STATUSES as readonly string[]).includes(status)
