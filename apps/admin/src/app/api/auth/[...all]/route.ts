import { NextRequest, NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@workspace/auth/server";

const handler = toNextJsHandler(auth);

/**
 * Endpoints that must not be reachable over HTTP. Nobody self-registers into
 * this app: staff accounts come from Google sign-in on the company domain,
 * and driver accounts are created server-side by fleet.registerDriver.
 * Nothing calls /update-user either — it would let a session rewrite its own
 * profile columns, and `type` is what the staff gate reads.
 *
 * Closing sign-up here rather than with `emailAndPassword.disableSignUp`
 * is deliberate — that option is checked inside the endpoint handler, so it
 * would also block the server-side auth.api.signUpEmail call that driver
 * registration depends on.
 *
 * This is defence in depth, not the gate: the databaseHooks in
 * packages/auth/src/server.ts are what actually protect `type`, because they
 * hold for every caller rather than only for requests arriving through this
 * route.
 */
const BLOCKED_ENDPOINTS = ["/sign-up/email", "/update-user"];

function isBlocked(request: NextRequest): boolean {
    const { pathname } = new URL(request.url);
    return BLOCKED_ENDPOINTS.some((endpoint) => pathname.endsWith(endpoint));
}

export async function POST(request: NextRequest) {
    if (isBlocked(request)) {
        return NextResponse.json(
            { code: "SIGN_UP_DISABLED", message: "Sign up is disabled" },
            { status: 403 },
        );
    }

    return handler.POST(request);
}

export const { GET } = handler;
