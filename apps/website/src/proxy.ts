import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "@workspace/i18n/middleware";

import { routing } from "@/i18n/routing";

// Root-level SEO routes (extension-less, so the matcher can't catch them
// all) — never locale-rewritten. Belt and suspenders with the matcher:
// a rewrite into [locale] would 404 these via the catch-all route.
const SEO_PATHS = new Set([
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/icon",
    "/apple-icon",
    "/opengraph-image",
    "/twitter-image",
    "/favicon.ico",
]);

const handleI18nRouting = createMiddleware(routing);

// Public site: the proxy does locale negotiation — no auth. Locale
// detection is off in the routing config so crawlers (cookieless) always
// see pt at unprefixed URLs; the switcher's Links store NEXT_LOCALE, and
// returning visitors with a non-default choice are redirected here. An
// explicit /en/... URL always wins over the cookie.
export default function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (SEO_PATHS.has(pathname)) return NextResponse.next();

    const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;
    if (
        cookieLocale &&
        cookieLocale !== routing.defaultLocale &&
        (routing.locales as readonly string[]).includes(cookieLocale) &&
        pathname !== `/${cookieLocale}` &&
        !pathname.startsWith(`/${cookieLocale}/`)
    ) {
        const url = request.nextUrl.clone();
        url.pathname = `/${cookieLocale}${pathname === "/" ? "" : pathname}`;
        // 307: the target depends on the visitor's cookie, never permanent
        return NextResponse.redirect(url, 307);
    }

    return handleI18nRouting(request);
}

export const config = {
    matcher: [
        // Skip Next.js internals, root SEO routes and all static files,
        // unless found in search params
        "/((?!api|_next|robots\\.txt$|sitemap\\.xml$|icon$|apple-icon$|opengraph-image$|twitter-image$|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|pdf|zip|webmanifest)).*)",
    ],
}
