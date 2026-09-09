import { NextRequest, NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@workspace/auth/server";

const handler = toNextJsHandler(auth);

/**
 * Nobody self-registers over HTTP here either: sign-up goes through
 * `onboarding.signUp`, which calls `auth.api.signUpEmail` server-side so
 * `type` — the column the tenant gate reads — is derived from the declared
 * company type or the inviting organization, never posted by the client.
 *
 * Closing sign-up here rather than with `emailAndPassword.disableSignUp`
 * is deliberate — that option is checked inside the endpoint handler, so it
 * would also block the server-side call the portal's own sign-up depends on.
 *
 * Unlike the admin, `/update-user` stays open: partners edit their own
 * profile from Settings, and the `user.update.before` hook in
 * packages/auth/src/server.ts is what keeps `type` and `status` out of
 * reach.
 *
 * The organization plugin's own write endpoints are closed: nothing in either
 * app calls them (companies are written by direct Drizzle insert/update —
 * `organizations.register` in Admin, `me.updateCompany` here), and left open
 * they answer to any owner or admin of the tenant. Defence in depth only —
 * `input: false` on the registry columns and `disableOrganizationDeletion`
 * in packages/auth/src/server.ts are what actually hold, for every caller.
 */
const BLOCKED_ENDPOINTS = ["/sign-up/email", "/organization/update", "/organization/delete"];

function isBlocked(request: NextRequest): boolean {
    const { pathname } = new URL(request.url);
    return BLOCKED_ENDPOINTS.some((endpoint) => pathname.endsWith(endpoint));
}

export async function POST(request: NextRequest) {
    if (isBlocked(request)) {
        return NextResponse.json(
            { code: "ENDPOINT_DISABLED", message: "This endpoint is disabled" },
            { status: 403 },
        );
    }

    return handler.POST(request);
}

export const { GET } = handler;
