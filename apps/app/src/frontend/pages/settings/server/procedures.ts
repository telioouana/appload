import { z } from "zod";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";

import { partnerConnection } from "@workspace/db/connections";
import { kycDocument } from "@workspace/db/kyc-documents";
import { movement } from "@workspace/db/movements";
import { order } from "@workspace/db/orders";
import { organization, user } from "@workspace/db/users";
import { AddressSchema, KycPagesSchema, type Address, type KycDocumentStatus } from "@workspace/db/types";

import {
    PLAN_QUOTA,
    SUBSCRIPTION_PLAN,
    trackingAllowance,
    type SubscriptionPlan,
    type TrackingAllowance,
} from "@workspace/domain/subscription";

import { isValid, today } from "@workspace/domain/kyc/derive";
import { isKycUrl } from "@workspace/domain/kyc/file-access";
import { CONTRACT_DOC } from "@workspace/domain/kyc/requirements";
import { currentDocuments, loadSubject, toCurrentDoc, writeDerivedStatus } from "@workspace/domain/kyc/subjects";
import { conditionCount } from "@workspace/domain/orders/predicates";
import { pendingOfferCount } from "@workspace/domain/orders/transition";

import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedTenantProcedure, tenantProcedure } from "@workspace/trpc/tenant";
import type { OrgStatus, OrgType, TenantPlan, TenantRole } from "@workspace/trpc/tenant-gate";

import type { db as Database } from "@workspace/db/db";

import { ChangePasswordBaseSchema } from "@/backend/schemas/settings";
import { UpdateCompanyBaseSchema } from "@/backend/schemas/company";
import { sectionPredicate, visibleMovements } from "@/frontend/pages/movements/server/projection";
import { myRequest, visibleOrders } from "@/frontend/pages/orders/server/projection";

type Db = typeof Database;

/**
 * The numbers on the rail, each for the one list it leads to: work partners
 * offered this company and are waiting on, its own orders a partner turned
 * down (to place again), the loads a dispute holds on each list, connection
 * requests it has not answered, and the brokerage's own queue — a carrier's
 * unanswered requests and booked orders with nobody driving, a shipper's
 * offers to decide.
 */
export type RailCounts = {
    received: number;
    declined: number;
    disputes: { orders: number; trips: number };
    partners: number;
    appload: { newRequests: number; toDispatch: number; offersToReview: number };
};

export type MeSession = {
    user: { id: string; name: string; email: string; image: string | null };
    organization: {
        id: string;
        name: string;
        type: OrgType;
        status: OrgStatus;
        nuit: string;
        email: string;
        phoneNumber: string;
        billingAddress: Address | null;
        physicalAddress: Address | null;
        kycStatus: string;
        /** Null until staff agree a plan with the company */
        subscriptionPlan: SubscriptionPlan | null;
        subscriptionExpiresAt: Date | null;
        portalActivatedAt: Date | null;
    };
    role: TenantRole;
    plan: TenantPlan;
    /** This month's tracked movements against what the plan allows */
    allowance: TrackingAllowance;
    /** Every tier and its monthly allowance, so the plan screens can list them */
    tiers: Array<{ plan: SubscriptionPlan; quota: number | null }>;
};

/**
 * Where the company's signed contract with Appload stands. `valid` and
 * `expired` are a comparison against today rather than a stored state — the
 * same rule the KYC derivation applies, so a contract is expired the day
 * after its date whether or not any sweep has noticed.
 */
export type ContractState = "missing" | "pending" | "valid" | "expired" | "rejected";

export type MeContract = {
    status: ContractState;
    /** The calendar day it runs to, as stored (YYYY-MM-DD) */
    expiresAt: string | null;
};

// The catalog lives in a module the browser cannot load (it reads the
// database), so the tiers travel to the client as data rather than as an
// import
const TIERS = SUBSCRIPTION_PLAN.map((plan) => ({ plan, quota: PLAN_QUOTA[plan] }));

// Calendar day, matching the pg `date` column the expiry is stored in
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "INVALID_DATE");

/**
 * The contract the company is currently on: its latest live submission.
 * Superseded rows are still the newest of their chain only until the one
 * replacing them is written, and a soft-deleted row is history, so both are
 * excluded the way `currentDocuments` excludes them for the whole set.
 */
async function latestContract(db: Db, organizationId: string) {
    const [row] = await db
        .select({
            id: kycDocument.id,
            status: kycDocument.status,
            expiresAt: kycDocument.expiresAt,
        })
        .from(kycDocument)
        .where(and(
            eq(kycDocument.subjectType, "organization"),
            eq(kycDocument.subjectId, organizationId),
            eq(kycDocument.type, CONTRACT_DOC),
            isNull(kycDocument.deletedAt),
        ))
        .orderBy(desc(kycDocument.createdAt))
        .limit(1);

    return row;
}

function contractState(doc: { status: KycDocumentStatus; expiresAt: string | null } | undefined): ContractState {
    if (!doc) return "missing";
    if (doc.status !== "approved") return doc.status;

    return isValid({ type: CONTRACT_DOC, status: doc.status, expiresAt: doc.expiresAt }, today())
        ? "valid"
        : "expired";
}

/**
 * An uploaded page has to be an object this company just wrote to our own
 * KYC bucket, under its own contract prefix. The bucket builds that path
 * from the three input values (packages/edgestore/src/server.ts), so
 * requiring them back in the URL is what ties the row to the file the upload
 * hook allowed — without it the mutation would file whatever URL it was
 * handed, including another subject's ID scan, as this company's contract.
 */
function assertContractUrl(url: string, organizationId: string) {
    let path: string;

    try {
        path = decodeURIComponent(new URL(url).pathname);
    } catch {
        path = "";
    }

    const filed = path.includes(`/organization/${organizationId}/${CONTRACT_DOC}/`);

    if (!isKycUrl(url, "organization", organizationId) || !filed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "INVALID_DOCUMENT_URL" });
    }
}

/**
 * The violated constraint name when the error (or its cause) is a postgres
 * unique violation (23505), else null — how duplicates become domain codes.
 * The same helper the onboarding router keeps private; the two rows are the
 * organization's own unique columns, and both writers have to name them.
 */
function uniqueViolationConstraint(error: unknown): string | null {
    const candidates = [error, (error as { cause?: unknown })?.cause] as Array<
        { code?: string; constraint?: string; detail?: string } | undefined
    >;

    for (const candidate of candidates) {
        if (candidate?.code === "23505") {
            return candidate.constraint ?? candidate.detail ?? "";
        }
    }

    return null;
}

/**
 * The form keeps its two addresses as four (possibly empty) strings, because
 * react-hook-form has to seed something. `AddressSchema` is what decides:
 * anything short of a complete picked place is stored as null rather than as
 * a half address the maps and PDFs could not use.
 */
function toAddress(value: Partial<Address> | undefined): Address | null {
    const parsed = AddressSchema.safeParse(value);

    return parsed.success ? parsed.data : null;
}

/**
 * The tenant's own account and company (plan §5, `me`): what the settings
 * page reads, the company edits owners and admins may make, and the password
 * change. Everything is scoped to `ctx.tenant`, never to an id from input.
 */
export const meRouter = createTRPCRouter({
    /**
     * Who is signed in and which company the portal is showing. Read live
     * rather than from the session cookie: the organization row carries the
     * plan and the KYC verdict, both of which staff change in Admin while a
     * partner is signed in.
     */
    session: tenantProcedure.query(async ({ ctx }): Promise<MeSession> => {
        const [account, company, allowance] = await Promise.all([
            ctx.db
                .select({
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    image: user.image,
                })
                .from(user)
                .where(eq(user.id, ctx.tenant.userId))
                .limit(1)
                .then((rows) => rows[0]),
            ctx.db
                .select({
                    id: organization.id,
                    name: organization.name,
                    type: organization.type,
                    status: organization.status,
                    nuit: organization.nuit,
                    email: organization.email,
                    phoneNumber: organization.phoneNumber,
                    billingAddress: organization.billingAddress,
                    physicalAddress: organization.physicalAddress,
                    kycStatus: organization.kycStatus,
                    subscriptionPlan: organization.subscriptionPlan,
                    subscriptionExpiresAt: organization.subscriptionExpiresAt,
                    portalActivatedAt: organization.portalActivatedAt,
                })
                .from(organization)
                .where(eq(organization.id, ctx.tenant.organizationId))
                .limit(1)
                .then((rows) => rows[0]),
            trackingAllowance(ctx.db, ctx.tenant.organizationId),
        ]);

        // The gate resolved both rows a moment ago, so a miss here is a row
        // deleted mid-request rather than a case the UI has to render
        if (!account || !company) {
            throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });
        }

        return {
            user: account,
            organization: company,
            role: ctx.tenant.role,
            plan: ctx.tenant.plan,
            allowance,
            tiers: TIERS,
        };
    }),

    /**
     * The rail's badges in one small read. Each counts rows the page its
     * entry opens will show — the offers received inside My trucks ▸
     * Procurement, the turned-down loads inside the partners tab's
     * Procurement (the rail adds the two for its one Procurement badge),
     * each tab's disputes (added the same way), the incoming requests on
     * Partners — so a badge never promises a row the page does not have.
     *
     * Its own read, never the pages' stats: the rail mounts above every
     * page's hydration boundary, and a query it observed first would be
     * hydrated only after the page's server render had already asked for it
     * again — without the cookie. The brokerage counts are the same
     * predicates `orders.stats` counts with.
     */
    railCounts: tenantProcedure.query(async ({ ctx }): Promise<RailCounts> => {
        const tenantId = ctx.tenant.organizationId;
        const shipper = ctx.tenant.orgType === "shipper";
        const zero = sql<number>`0`.mapWith(Number);

        const [loads, disputes, connections, brokerage] = await Promise.all([
            ctx.db
                .select({
                    received: sql<number>`count(*) filter (where ${movement.carrierOrgId} = ${tenantId} and ${movement.status} = 'offered')::int`,
                    declined: sql<number>`count(*) filter (where ${movement.organizationId} = ${tenantId} and ${movement.status} = 'declined')::int`,
                })
                .from(movement)
                .where(and(
                    or(eq(movement.organizationId, tenantId), eq(movement.carrierOrgId, tenantId)),
                    sql`${movement.status} in ('offered', 'declined')`,
                ))
                .then((rows) => rows[0]),
            // The Disputes sections' own predicates, so each badge is its list
            ctx.db
                .select({
                    orders: sql<number>`count(*) filter (where ${sectionPredicate("orders", "disputes", tenantId)})::int`,
                    trips: sql<number>`count(*) filter (where ${sectionPredicate("trips", "disputes", tenantId)})::int`,
                })
                .from(movement)
                .where(visibleMovements(tenantId))
                .then((rows) => rows[0]),
            ctx.db
                .select({ incoming: sql<number>`count(*)::int` })
                .from(partnerConnection)
                .where(and(eq(partnerConnection.targetOrgId, tenantId), eq(partnerConnection.status, "pending")))
                .then((rows) => rows[0]),
            ctx.db
                .select({
                    newRequests: shipper ? zero : conditionCount(myRequest(tenantId, ["requested"])),
                    toDispatch: shipper
                        ? zero
                        : conditionCount(and(eq(order.carrierId, tenantId), eq(order.status, "booked"), isNull(order.driverId))!),
                    offersToReview: shipper
                        ? conditionCount(and(eq(order.status, "prospect"), sql`${pendingOfferCount} > 0`)!)
                        : zero,
                })
                .from(order)
                .where(visibleOrders(tenantId, ctx.tenant.orgType))
                .then((rows) => rows[0]),
        ]);

        return {
            received: Number(loads?.received ?? 0),
            declined: Number(loads?.declined ?? 0),
            disputes: { orders: Number(disputes?.orders ?? 0), trips: Number(disputes?.trips ?? 0) },
            partners: Number(connections?.incoming ?? 0),
            appload: {
                newRequests: Number(brokerage?.newRequests ?? 0),
                toDispatch: Number(brokerage?.toDispatch ?? 0),
                offersToReview: Number(brokerage?.offersToReview ?? 0),
            },
        };
    }),

    /**
     * The company's own contact details and addresses. Owner and admin only
     * (the `organization: ["update"]` statement).
     *
     * Name and NUIT are deliberately absent: they are what Appload's registry,
     * the logbook and every issued document are keyed on, so a correction to
     * either is a staff edit in Admin, not a self-service one.
     */
    updateCompany: authorizedTenantProcedure("organization", ["update"])
        .input(UpdateCompanyBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ organizationId: string }> => {
            const values: Partial<typeof organization.$inferInsert> = {};

            if (input.email !== undefined) values.email = input.email.trim();
            if (input.phoneNumber !== undefined) values.phoneNumber = input.phoneNumber.trim();
            if (input.billingAddress !== undefined) values.billingAddress = toAddress(input.billingAddress);
            if (input.physicalAddress !== undefined) values.physicalAddress = toAddress(input.physicalAddress);

            if (Object.keys(values).length === 0) {
                return { organizationId: ctx.tenant.organizationId };
            }

            try {
                const [updated] = await ctx.db
                    .update(organization)
                    .set(values)
                    // The predicate is the gate's organization id, never an
                    // id from input
                    .where(eq(organization.id, ctx.tenant.organizationId))
                    .returning({ id: organization.id });

                if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

                return { organizationId: updated.id };
            } catch (error) {
                if (error instanceof TRPCError) throw error;

                const constraint = uniqueViolationConstraint(error);

                if (constraint === null) throw error;
                if (constraint.includes("email")) {
                    throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_EMAIL" });
                }
                if (constraint.includes("phone")) {
                    throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_PHONE" });
                }

                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
            }
        }),

    /**
     * Where the company's signed contract with Appload stands. Its own small
     * read rather than a field on `me.session`: the card that shows it is one
     * tab of the settings page, and the upload below is what refetches it.
     */
    contract: tenantProcedure.query(async ({ ctx }): Promise<MeContract> => {
        const row = await latestContract(ctx.db, ctx.tenant.organizationId);

        return { status: contractState(row), expiresAt: row?.expiresAt ?? null };
    }),

    /**
     * Files the countersigned contract. Owner and admin only (the
     * `organization: ["update"]` statement): it is the company's agreement
     * with Appload, not a working document.
     *
     * The row lands `pending` — uploading is not approving, and only a staff
     * review in Admin turns it into something partners read as valid. A
     * previous submission is superseded rather than overwritten, so a
     * rejection and the contract answering it both stay on record, exactly
     * as Admin's own upload writes the chain.
     */
    uploadContract: authorizedTenantProcedure("organization", ["update"])
        .input(z.object({ pages: KycPagesSchema, expiresAt: isoDate.optional() }))
        .mutation(async ({ ctx, input }): Promise<MeContract> => {
            const tenantId = ctx.tenant.organizationId;

            // The contract is a required document for a carrier and no part of
            // a shipper's file at all — the card hides the row for one, and
            // Admin's own upload refuses the type for the same reason
            if (ctx.tenant.orgType !== "carrier") {
                throw new TRPCError({ code: "BAD_REQUEST", message: "DOCUMENT_NOT_APPLICABLE" });
            }

            for (const page of input.pages) assertContractUrl(page.url, tenantId);

            const subject = await loadSubject(ctx.db, "organization", tenantId);
            const existing = await latestContract(ctx.db, tenantId);

            const [document] = await ctx.db
                .insert(kycDocument)
                .values({
                    // The subject is the gate's organization, never an id
                    // from input — the same predicate the URL check demanded
                    subjectType: "organization",
                    subjectId: tenantId,
                    type: CONTRACT_DOC,
                    pages: input.pages,
                    expiresAt: input.expiresAt ?? null,
                    supersedesId: existing?.id ?? null,
                    uploadedBy: ctx.tenant.userId,
                })
                .returning({ status: kycDocument.status, expiresAt: kycDocument.expiresAt });

            if (!document) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
            }

            // The company's verification is derived from the documents it has,
            // and this one just replaced an approved contract with a pending
            // submission — so the stored verdict is rewritten here rather than
            // left claiming more than the file supports until staff look at it.
            // The same three lines Admin's own upload ends on.
            const current = await currentDocuments(ctx.db, subject);
            await writeDerivedStatus(ctx.db, subject, current.map(toCurrentDoc));

            return { status: contractState(document), expiresAt: document.expiresAt };
        }),

    /**
     * A new password for the signed-in account. Routed through tRPC rather
     * than straight to `authClient` so the portal's mutations all log through
     * one door; the endpoint itself is Better Auth's, and its
     * `sensitiveSessionMiddleware` re-reads the session from the cookie with
     * the cache disabled — so the request headers must be forwarded.
     *
     * Better Auth's own `revokeOtherSessions` flag is deliberately not used:
     * it deletes *every* session, including this one, and hands back a
     * replacement cookie. That cookie would have to travel on a response
     * whose headers tRPC has already sent (the client batches over
     * `httpBatchStreamLink`, so the body streams while the procedure runs),
     * and losing it would sign the caller out of the browser they are
     * standing in. `/revoke-other-sessions` does the same job by keeping the
     * current token and dropping the rest — no new cookie, nothing to lose.
     */
    changePassword: tenantProcedure
        .input(ChangePasswordBaseSchema)
        .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
            try {
                await ctx.authApi.changePassword({
                    body: {
                        currentPassword: input.currentPassword,
                        newPassword: input.newPassword,
                        revokeOtherSessions: false,
                    },
                    headers: ctx.headers,
                });
            } catch (error) {
                if (error instanceof APIError) {
                    // INVALID_PASSWORD is the overwhelmingly common one and
                    // the client puts it on the field; the rest (too short,
                    // no credential account) travel by the same route
                    const code = (error.body as { code?: string } | undefined)?.code ?? "CHANGE_PASSWORD_FAILED";

                    throw new TRPCError({ code: "BAD_REQUEST", message: code });
                }

                throw error;
            }

            if (input.revokeOtherSessions) {
                try {
                    await ctx.authApi.revokeOtherSessions({ headers: ctx.headers });
                } catch (error) {
                    // The password is already changed, which is what the
                    // caller came for; the other devices keep a session they
                    // can no longer re-create once it expires
                    console.error("[me.changePassword] revoking other sessions failed:", error);
                }
            }

            return { ok: true as const };
        }),
});
