import { defineRouting } from "@workspace/i18n/routing";

import { LOCALES, DEFAULT_LOCALE } from "@workspace/i18n/locales";

// Website-owned routing config (each app defines its own; only the locale
// list is shared). pt owns the clean URLs (/, /cliente, …) and en lives
// under /en — both languages get stable URLs Google can index, linked by
// hreflang in the page metadata (alternateLinks off so that stays the
// single source). localeDetection off keeps / deterministic for crawlers;
// returning visitors are redirected by the NEXT_LOCALE cookie in proxy.ts.
// pathnames localize the slugs themselves (/shipper ↔ /cliente); entries
// without a pt override share one slug across locales.
export const routing = defineRouting({
    locales: LOCALES,
    defaultLocale: DEFAULT_LOCALE,

    localeDetection: false,
    localePrefix: "as-needed",
    alternateLinks: false,

    pathnames: {
        "/": "/",
        "/shipper": {
            pt: "/cliente",
        },
        "/carrier": {
            pt: "/transportador",
        },
        "/team": {
            pt: "/equipa",
        },
        "/contact": {
            pt: "/contacto",
        },
        "/faq": "/faq",
        "/insurance": {
            pt: "/seguro",
        },
        "/terms-and-conditions": {
            pt: "/termos-e-condicoes",
        },
        "/privacy-policy": {
            pt: "/politica-de-privacidade",
        },
    },
});
