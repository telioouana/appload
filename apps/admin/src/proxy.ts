import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";

import { Locale } from "@workspace/i18n";
import { routing } from "@workspace/i18n/routing";
import createMiddleware from "@workspace/i18n/middleware";

import { authRoutes, DEFAULT_LOGIN_REDIRECT, publicRoutes } from "@/routes"

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

    // Localized pathnames (e.g. "/iniciar-sessao") must be mapped back to
    // their internal names (e.g. "/sign-in") before matching against routes.
    const localizedToInternal: Record<string, string> = {};
    for (const [internal, value] of Object.entries(routing.pathnames)) {
        if (typeof value === "string") {
            localizedToInternal[value] = internal;
        } else {
            for (const localized of Object.values(value)) {
                localizedToInternal[localized] = internal;
            }
        }
    }
    const internalPath = localizedToInternal[nextUrl.pathname] ?? nextUrl.pathname;

    const isPublicRoute = publicRoutes.includes(internalPath)
    const isAuthRoute = authRoutes.includes(internalPath)

    // API routes (Better Auth, tRPC, webhooks) answer with JSON and handle
    // their own auth — locale-prefixing or redirecting them to the sign-in
    // page would hand HTML to API clients
    if (nextUrl.pathname.startsWith("/api")) return NextResponse.next()

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

    if (isAuthRoute && sessionCookie) {
        const redirectUrl = new URL(DEFAULT_LOGIN_REDIRECT, nextUrl);
        const callback =
            nextUrl.searchParams.get("callback") ??
            nextUrl.searchParams.get("callbackUrl");

        if (callback) {
            redirectUrl.searchParams.set("callback", callback);
        }

        return NextResponse.redirect(redirectUrl);
    }

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