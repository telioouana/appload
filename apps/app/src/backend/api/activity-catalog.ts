import type { ActivityCatalog } from "@workspace/trpc/activity-log";

/**
 * Enriches the auto-logged mutation rows with display-safe params for the
 * activity log. Keyed by tRPC path — string keys keep this file free of
 * router imports (only type-imports, so no runtime cycle with _app.ts).
 *
 * Extractors receive raw (pre-zod) input and may receive undefined output
 * (failed mutation): always use optional access. Params here are a
 * whitelist — never dump raw input — and in this app that whitelist is
 * strictly scalar: no email addresses, phone numbers or NUITs, only the
 * booleans and ids that say what happened.
 */
export const activityCatalog: ActivityCatalog = {
    // Public, so it is never logged (only protectedProcedure writes rows);
    // catalogued anyway so the shape is decided in one place if it ever
    // moves behind a session
    "onboarding.signUp": {
        params: (input) => ({
            companyType: input?.companyType ?? "",
            hasInvitation: Boolean(input?.invitationId),
        }),
    },
    "onboarding.createOrganization": {
        entity: (_input, output?: { organizationId?: string }) =>
            output?.organizationId ? { type: "organization", id: output.organizationId } : null,
        params: (input, output?: { organizationId?: string }) => ({
            organizationId: output?.organizationId ?? "",
            // Which optional blocks were filled, never their contents
            hasEmail: Boolean(input?.email),
            hasBillingAddress: Boolean(input?.billingAddress?.placeId),
            hasPhysicalAddress: Boolean(input?.physicalAddress?.placeId),
        }),
    },
    "onboarding.claim": {
        entity: (input) =>
            input?.organizationId ? { type: "organization", id: String(input.organizationId) } : null,
        params: (input, output?: { approved?: boolean }) => ({
            organizationId: input?.organizationId ?? "",
            // True when the verified address matched the registered one, so
            // an automatic approval is told apart from a queued request
            approved: output?.approved ?? false,
        }),
    },
    "me.updateCompany": {
        entity: (_input, output?: { organizationId?: string }) =>
            output?.organizationId ? { type: "organization", id: output.organizationId } : null,
        params: (input) => ({
            // Which blocks the patch carried, never their contents
            changedEmail: Boolean(input?.email),
            changedPhone: Boolean(input?.phoneNumber),
            changedBillingAddress: Boolean(input?.billingAddress?.placeId),
            changedPhysicalAddress: Boolean(input?.physicalAddress?.placeId),
        }),
    },
    "me.changePassword": {
        // Nothing from the input is loggable here beyond the one choice that
        // has a consequence outside this request
        params: (input) => ({
            revokedOtherSessions: Boolean(input?.revokeOtherSessions),
        }),
    },
};
