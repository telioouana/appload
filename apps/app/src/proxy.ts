import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";

import { Locale } from "@workspace/i18n";
import { routing } from "@/i18n/routing";
import createMiddleware from "@workspace/i18n/middleware";

import { authRoutes, DEFAULT_LOGIN_REDIRECT, openDynamicRoutes, openRoutes, publicRoutes } from "@/routes"

// Localized pathnames (e.g. "/iniciar-sessao") must be mapped back to their
// internal names (e.g. "/sign-in") before matching against routes. Built once
// at module scope: the table is the routing config, which never changes.
const localizedToInternal: Record<string, string> = {};
for (const [internal, value] of Object.entries(routing.pathnames)) {
    if (typeof value === "string") {
        localizedToInternal[value] = internal;
    } else {
        for (const localized of Object.values(value as Record<string, string>)) {
            localizedToInternal[localized] = internal;
        }
    }
}

// The same folding for the dynamic open routes, which no exact table can
// match: "/accept-invitation/[id]" and "/aceitar-convite/[id]" become the
// prefixes "/accept-invitation" and "/aceitar-convite".
const openPrefixes: string[] = openDynamicRoutes.flatMap((internal) => {
    const value = routing.pathnames[internal as keyof typeof routing.pathnames];
    const variants = typeof value === "string"
        ? [value]
        : [internal, ...Object.values(value as Record<string, string>)];

    return variants.map((variant) => variant.split("/[")[0] as string);
});

export default async function proxy(request: NextRequest) {
    // Step 1: Use the incoming request (example)
    const defaultLocale = request.headers.get("x-your-custom-locale") as Locale || "pt";

    // Step 2: Create and call the next-intl middleware (example)
    const handleI18nRouting = createMiddleware(routing);
    const response = handleI18nRouting(request);

    // Step 3: Alter the response (example)
    response.headers.set("x-your-custom-locale", defaultLocale);

    const sessionCookie = getSessionCookie(request);
    const { nextUrl } = request

    const internalPath = localizedToInternal[nextUrl.pathname] ?? nextUrl.pathname;

    const isPublicRoute = publicRoutes.includes(internalPath)
    const isAuthRoute = authRoutes.includes(internalPath)
    // Reachable signed in and signed out alike: no redirect in either
    // direction, whatever the session cookie says
    const isOpenRoute =
        openRoutes.includes(internalPath) ||
        openPrefixes.some((prefix) =>
            nextUrl.pathname === prefix || nextUrl.pathname.startsWith(`${prefix}/`)
        )

    // API routes (Better Auth, tRPC, webhooks) answer with JSON and handle
    // their own auth — locale-prefixing or redirecting them to the sign-in
    // page would hand HTML to API clients
    if (nextUrl.pathname.startsWith("/api")) return NextResponse.next()

    if (isOpenRoute) return response

    if (isPublicRoute) {
        return NextResponse.redirect(new URL(
            sessionCookie ? DEFAULT_LOGIN_REDIRECT : "/sign-in",
            nextUrl
        ))
    }

    if (!isAuthRoute && !sessionCookie) {
        let callbackUrl = nextUrl.pathname
        if (nextUrl.search) {
            callbackUrl += nextUrl.search
        }

        const encodedCallbackUrl = encodeURIComponent(callbackUrl)

        return NextResponse.redirect(new URL(
            `/sign-in?callbackUrl=${encodedCallbackUrl}`,
            nextUrl
        ));
    }

    // Signed-in visitors on an auth route are sent away by the page itself
    // (src/lib/auth-redirect.ts), which validates the session. Deciding it
    // here from the cookie's mere presence loops with the protected layout
    // whenever the cookie is stale: /sign-in → /dashboard → /sign-in …

    return response;
}

export const config = {
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|pdf|zip|webmanifest)).*)",
        // Always run for API routes
        "/(api|trpc)(.*)",
    ],
}
