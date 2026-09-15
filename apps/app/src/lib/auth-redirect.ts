import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@workspace/auth/server";

import { DEFAULT_LOGIN_REDIRECT } from "@/routes";

/**
 * Sends an already signed-in visitor away from the auth screens. Lives on the
 * page, not in proxy.ts, because the proxy only sees whether a session cookie
 * EXISTS: a stale or revoked cookie (sign-out elsewhere, expired session)
 * would make the proxy bounce /sign-in to /dashboard while the protected
 * layout, which validates the session, bounces /dashboard back to /sign-in —
 * a redirect loop. Here the session is validated, so a dead cookie simply
 * renders the form and the next sign-in overwrites it.
 *
 * `callback` is the path the visitor was heading to; only same-origin paths
 * are honoured (no protocol-relative or absolute URLs).
 */
export async function redirectIfSignedIn(callback?: string | null): Promise<void> {
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session) return;

    const target =
        callback && callback.startsWith("/") && !callback.startsWith("//") && !callback.startsWith("/\\")
            ? callback
            : DEFAULT_LOGIN_REDIRECT;

    redirect(target);
}

/** First value of a search param, as URLSearchParams.get would return it. */
export function firstParam(value: string | string[] | undefined): string | null {
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
