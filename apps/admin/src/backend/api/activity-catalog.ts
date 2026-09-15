import type { ActivityCatalog } from "@workspace/trpc/activity-log";

import type { OrgOption } from "./routers/organizations";
import type { DriverOption, VehicleOption } from "./routers/fleet";
import type { ChatConversation } from "@workspace/db/chats";
import type { KycDocument } from "@workspace/db/kyc-documents";
import type { CreateOrderOutput } from "@/frontend/pages/order/server/procedures";
import type { OfferRow } from "@/frontend/pages/order/server/offers-procedures";

// (transition/resolveFlag rows carry ids and statuses only — never notes
// or document URLs, which may be sensitive)

type KycReviewOutput = {
    document: KycDocument;
    kycStatus: string;
    ownership: { status: string; carrierFlagged: boolean } | null;
};

// Enriches the auto-logged mutation rows with display-safe params for the
// activity log. Keyed by tRPC path — string keys keep this file free of
// router imports (only type-imports, so no runtime cycle with _app.ts).
//
// Extractors receive raw (pre-zod) input and may receive undefined output
// (failed mutation): always use optional access. Params here are a
// whitelist — never dump raw input (PII/bloat) — and every key referenced
// by an ActivityLog i18n message must be emitted (empty string, not null,
// for placeholder fields).
export const activityCatalog: ActivityCatalog = {
    "order.create": {
        entity: (_input, output?: CreateOrderOutput) =>
            output ? { type: "order", id: output.orderId } : null,
        params: (input, output?: CreateOrderOutput) => ({
            orderId: output?.orderId ?? "",
            shipperName: input?.shipperName ?? "",
            // An order carries no carrier of its own any more: the one it is
            // created with is the carrier of the offer the payload accepts
            carrierName: input?.offers?.find((offer: { accepted?: boolean }) => offer?.accepted)?.carrierName ?? "",
            truckPlate: input?.truckPlate ?? "",
            status: output?.status ?? input?.status ?? "",
        }),
    },
    "order.update": {
        entity: (input) =>
            input?.orderId ? { type: "order", id: String(input.orderId) } : null,
        params: (input) => ({
            orderId: input?.orderId ?? "",
            // Field names only — values may be sensitive (amounts, invoices)
            changedFields: Object.keys(input?.patch ?? {}).join(", "),
        }),
    },
    "order.updateDeal": {
        entity: (input) =>
            input?.orderId ? { type: "order", id: String(input.orderId) } : null,
        params: (input) => ({
            orderId: input?.orderId ?? "",
            // Status only — the payload is a full form snapshot (amounts...)
            status: input?.values?.status ?? "",
        }),
    },
    "order.transition": {
        entity: (input) =>
            input?.orderId ? { type: "order", id: String(input.orderId) } : null,
        params: (input) => ({
            orderId: input?.orderId ?? "",
            to: input?.to ?? "",
        }),
    },
    "order.resolveFlag": {
        entity: (input) =>
            input?.orderId ? { type: "order", id: String(input.orderId) } : null,
        params: (input) => ({
            orderId: input?.orderId ?? "",
        }),
    },
    // One row for the batch: the target and how many rows made it, never
    // the note (it is a free text the transition rows keep per order)
    "orders.bulkTransition": {
        params: (input, output?: { results: { ok: boolean }[] }) => ({
            to: input?.to ?? "",
            count: Array.isArray(input?.orders) ? input.orders.length : 0,
            failed: output?.results.filter((result) => !result.ok).length ?? 0,
        }),
    },
    // Carrier offers: who quoted, for how much, and where the offer ended
    // up. The price is the one figure that is deliberately logged — it is
    // the whole point of the record and it is Appload's own commercial
    // data, not partner PII. The free-text notes and decision reasons stay
    // out. Only `create` names an order: the other three are addressed by
    // the offer's uuid, and the row's `order_id` is a primary key, not the
    // human "APPL021.26" the log links on.
    "offers.create": {
        entity: (input) =>
            input?.orderId ? { type: "order", id: String(input.orderId) } : null,
        params: (input, output?: OfferRow) => ({
            orderId: input?.orderId ?? "",
            carrierName: output?.carrierName ?? input?.values?.carrierName ?? "",
            total: output?.total ?? "",
            currency: output?.currency ?? input?.values?.currency ?? "",
            status: output?.status ?? "",
        }),
    },
    "offers.update": {
        params: (input, output?: OfferRow) => ({
            offerId: input?.offerId ?? "",
            carrierName: output?.carrierName ?? "",
            total: output?.total ?? "",
            currency: output?.currency ?? "",
            status: output?.status ?? "",
        }),
    },
    "offers.decide": {
        params: (input, output?: OfferRow) => ({
            offerId: input?.offerId ?? "",
            carrierName: output?.carrierName ?? "",
            total: output?.total ?? "",
            currency: output?.currency ?? "",
            status: output?.status ?? input?.status ?? "",
        }),
    },
    // A removed offer leaves nothing to report but its id — the mutation
    // returns only that, and the row it described is gone
    "offers.remove": {
        params: (input) => ({
            offerId: input?.offerId ?? "",
        }),
    },
    // Disputes log the order, the cause and the state — never the
    // description or the amounts claimed
    "disputes.open": {
        entity: (input) =>
            input?.orderId ? { type: "order", id: String(input.orderId) } : null,
        params: (input) => ({
            orderId: input?.orderId ?? "",
            reason: input?.reason ?? "",
        }),
    },
    "disputes.update": {
        entity: (_input, output?: { orderId: string }) =>
            output ? { type: "order", id: output.orderId } : null,
        params: (input, output?: { orderId: string }) => ({
            orderId: output?.orderId ?? "",
            changedFields: Object.keys(input?.patch ?? {}).join(", "),
        }),
    },
    "disputes.resolve": {
        entity: (_input, output?: { orderId: string }) =>
            output ? { type: "order", id: output.orderId } : null,
        params: (input, output?: { orderId: string }) => ({
            orderId: output?.orderId ?? "",
            status: input?.status ?? "",
        }),
    },
    "documents.create": {
        entity: (input) =>
            input?.orderId ? { type: "order", id: String(input.orderId) } : null,
        // Type, party and the structured note reason (an enum code) only —
        // amounts and free-text descriptions stay out of the log
        params: (input) => ({
            orderId: input?.orderId ?? "",
            type: input?.type ?? "",
            party: input?.party ?? "",
            reasonCode: input?.reasonCode ?? "",
        }),
    },
    "documents.softDelete": {
        params: (input) => ({
            documentId: input?.documentId ?? "",
        }),
    },
    "fleet.registerTruck": {
        entity: (_input, output?: VehicleOption) =>
            output ? { type: "truck", id: output.regPlate } : null,
        params: (input, output?: VehicleOption) => ({
            regPlate: output?.regPlate ?? input?.regPlate ?? "",
            carrierId: input?.carrierId ?? "",
        }),
    },
    "fleet.registerTrailer": {
        entity: (_input, output?: VehicleOption) =>
            output ? { type: "trailer", id: output.regPlate } : null,
        params: (input, output?: VehicleOption) => ({
            regPlate: output?.regPlate ?? input?.regPlate ?? "",
            carrierId: input?.carrierId ?? "",
        }),
    },
    "fleet.registerLink": {
        entity: (_input, output?: VehicleOption) =>
            output ? { type: "link", id: output.regPlate } : null,
        params: (input, output?: VehicleOption) => ({
            regPlate: output?.regPlate ?? input?.regPlate ?? "",
            carrierId: input?.carrierId ?? "",
        }),
    },
    "fleet.registerDriver": {
        entity: (_input, output?: DriverOption) =>
            output ? { type: "driver", id: output.id } : null,
        params: (input) => ({
            name: input?.name ?? "",
            carrierId: input?.carrierId ?? "",
        }),
    },
    // Verification rows carry the subject, the document type and the
    // decision. Never the pages' URLs, the document number, or the
    // reviewer's reason — all of those are the sensitive part.
    "kyc.upload": {
        entity: (input) =>
            input?.subjectId ? { type: String(input.subjectType), id: String(input.subjectId) } : null,
        params: (input) => ({
            subjectType: input?.subjectType ?? "",
            subjectId: input?.subjectId ?? "",
            documentType: input?.type ?? "",
        }),
    },
    "kyc.review": {
        entity: (_input, output?: KycReviewOutput) =>
            output ? { type: output.document.subjectType, id: output.document.subjectId } : null,
        params: (input, output?: KycReviewOutput) => ({
            documentType: output?.document.type ?? "",
            decision: input?.decision ?? "",
            kycStatus: output?.kycStatus ?? "",
            ownershipStatus: output?.ownership?.status ?? "",
        }),
    },
    "kyc.flagRisk": {
        entity: (input) =>
            input?.organizationId ? { type: "organization", id: String(input.organizationId) } : null,
        params: (input) => ({
            organizationId: input?.organizationId ?? "",
            level: input?.level ?? "",
        }),
    },
    "kyc.clearRisk": {
        entity: (input) =>
            input?.organizationId ? { type: "organization", id: String(input.organizationId) } : null,
        params: (input) => ({
            organizationId: input?.organizationId ?? "",
        }),
    },
    // Suspension notes are the exception to "no free text in params": the
    // mutation demands a justification, and the activity log is the only
    // place it is kept. It is staff-authored reasoning about an action they
    // took, not partner data — but it is still truncated.
    "kyc.suspend": {
        entity: (input) =>
            input?.subjectId ? { type: String(input.subjectType), id: String(input.subjectId) } : null,
        params: (input) => ({
            subjectType: input?.subjectType ?? "",
            subjectId: input?.subjectId ?? "",
            note: String(input?.note ?? "").slice(0, 300),
        }),
    },
    "kyc.unsuspend": {
        entity: (input) =>
            input?.subjectId ? { type: String(input.subjectType), id: String(input.subjectId) } : null,
        params: (input, output?: { kycStatus: string }) => ({
            subjectType: input?.subjectType ?? "",
            subjectId: input?.subjectId ?? "",
            kycStatus: output?.kycStatus ?? "",
            note: String(input?.note ?? "").slice(0, 300),
        }),
    },
    "organizations.register": {
        entity: (_input, output?: OrgOption) =>
            output ? { type: "organization", id: output.id } : null,
        params: (input) => ({
            name: input?.name ?? "",
            type: input?.type ?? "",
        }),
    },
    // The plan and its end date are commercial terms Appload set, not
    // partner data — both are logged
    "organizations.setSubscription": {
        entity: (input) =>
            input?.id ? { type: "organization", id: String(input.id) } : null,
        params: (input, output?: { name: string; plan: string | null; expiresAt: Date | null }) => ({
            name: output?.name ?? "",
            // A null plan is "no plan agreed", which the log names rather
            // than leaving blank
            plan: output?.plan ?? input?.plan ?? "none",
            expiresAt: output?.expiresAt ? output.expiresAt.toISOString().slice(0, 10) : "",
        }),
    },
    // Portal claims: who was answered and how. The rejection note is staff
    // reasoning about their own decision, and the claim row is the only
    // other place it is kept — truncated, like the suspension notes above
    "partners.decideClaim": {
        entity: (_input, output?: { id: string }) =>
            output ? { type: "claim", id: output.id } : null,
        params: (input, output?: { status: string }) => ({
            claimId: input?.id ?? "",
            decision: output?.status ?? input?.decision ?? "",
            note: String(input?.note ?? "").slice(0, 300),
        }),
    },
    // The invited address is the whole point of the record: it is who was
    // handed the keys to a partner's portal account
    "partners.inviteOwner": {
        entity: (input) =>
            input?.organizationId ? { type: "organization", id: String(input.organizationId) } : null,
        params: (input) => ({
            organizationId: input?.organizationId ?? "",
            email: input?.email ?? "",
        }),
    },
    // Partner edits log which fields changed, never the values (contact
    // details and addresses are personal data)
    "organizations.update": {
        entity: (input) =>
            input?.id ? { type: "organization", id: String(input.id) } : null,
        params: (input, output?: OrgOption) => ({
            name: output?.name ?? "",
            changedFields: Object.keys(input?.patch ?? {}).join(", "),
        }),
    },
    "fleet.updateDriver": {
        entity: (input) =>
            input?.id ? { type: "driver", id: String(input.id) } : null,
        params: (input) => ({
            driverId: input?.id ?? "",
            changedFields: Object.keys(input?.patch ?? {}).join(", "),
        }),
    },
    "fleet.updateVehicle": {
        entity: (input) =>
            input?.id ? { type: String(input.kind ?? "truck"), id: String(input.id) } : null,
        params: (input, output?: { regPlate: string }) => ({
            kind: input?.kind ?? "",
            regPlate: output?.regPlate ?? "",
            changedFields: Object.keys(input?.patch ?? {}).join(", "),
        }),
    },
    "fleet.assignDriver": {
        entity: (input) =>
            input?.driverId ? { type: "driver", id: String(input.driverId) } : null,
        params: (input) => ({
            driverId: input?.driverId ?? "",
            truckId: input?.truckId ?? "",
        }),
    },
    "chats.start": {
        entity: (_input, output?: { conversation: ChatConversation; existing: boolean }) =>
            output ? { type: "conversation", id: output.conversation.id } : null,
        params: (input, output?: { conversation: ChatConversation; existing: boolean }) => ({
            driverName: input?.driverName ?? "",
            existing: output?.existing ?? false,
        }),
    },
    "chats.send": {
        entity: (input) =>
            input?.conversationId
                ? { type: "conversation", id: String(input.conversationId) }
                : null,
        // Deliberately no message body — metadata only
        params: (input) => ({
            conversationId: input?.conversationId ?? "",
        }),
    },
    // No params by design: the whole input is the new password. Uncatalogued
    // mutations already log with empty params, so this entry changes no
    // behaviour — it states the omission rather than leaving it to inference.
    "settings.setPassword": {
        params: () => ({}),
    },
};
