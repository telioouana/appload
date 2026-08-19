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
export const ORDER_STATUS = ["prospect", "booked", "to-loading", "at-loading", "loading", "waiting-documents", "on-route", "stopped", "issue", "at-border", "at-offloading", "offloading", "delivered", "completed", "cancelled", "underbid"] as const
export const PACKING = ["bags-1kg", "bags-2kg", "bags-5kg", "bags-25kg", "bags-30kg", "bags-50kg", "bags-100kg", "bags-1ton", "bottle-1l", "bottle-5l", "bottle-10l", "bottle-20l", "bottle-25l", "container-20ft", "container-40ft", "boxes", "pallets", "noPacking", "other"] as const
export const YEARS = ["1981", "1982", "1983", "1984", "1985", "1986", "1987", "1988", "1989", "1990", "1991", "1992", "1993", "1994", "1995", "1996", "1997", "1998", "1999", "2000", "2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009", "2010", "2011", "2012", "2013", "2014", "2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"] as const

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