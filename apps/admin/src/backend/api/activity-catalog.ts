import type { ActivityCatalog } from "@workspace/trpc/activity-log";

import type { OrgOption } from "./routers/organizations";
import type { DriverOption, VehicleOption } from "./routers/fleet";
import type { ChatConversation } from "@workspace/db/chats";
import type { KycDocument } from "@workspace/db/kyc-documents";
import type { CreateOrderOutput } from "@/frontend/pages/order/server/procedures";

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
            carrierName: input?.carrierName ?? "",
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
