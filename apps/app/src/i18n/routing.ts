import { defineRouting } from "@workspace/i18n/routing";

import { LOCALES, DEFAULT_LOCALE } from "@workspace/i18n/locales";

// Portal-owned routing config (each app defines its own; only the locale
// list is shared). Like the admin, the partner portal keeps locales out of
// its URLs entirely — the Portuguese slugs below are what a pt visitor
// sees, and the English keys are the internal names every `Link` uses.
export const routing = defineRouting({
    locales: LOCALES,
    defaultLocale: DEFAULT_LOCALE,

    localeDetection: true,
    localePrefix: "never",

    pathnames: {
        "/": "/",
        "/dashboard": "/dashboard",
        "/partners": {
            pt: "/parceiros"
        },
        "/partners/[kind]": {
            pt: "/parceiros/[kind]"
        },
        "/fleet/[kind]": {
            pt: "/frota/[kind]"
        },
        "/drivers": {
            pt: "/motoristas"
        },
        // The company's own loads, on one page: the ones its own trucks move
        // and the ones somebody else moves are two tabs (`?tab=own | partners`)
        // of the same section. A load's page is a static segment beside the
        // section, so a trip handed to a partner keeps its address
        "/orders": {
            pt: "/pedidos"
        },
        "/orders/[section]": {
            pt: "/pedidos/[section]"
        },
        "/orders/load/[loadId]": {
            pt: "/pedidos/carga/[loadId]"
        },
        // Appload's brokerage: requests, offers, standing quotes and the
        // orders Appload books, beside the company's own loads rather than
        // mixed into them. Static segments sit beside the dynamic one, as in
        // the admin — two sibling dynamic segments are not allowed, and a
        // static one wins the match. The code behind these pages is still
        // named `orders` and `quotes` (frontend/pages, App.orders,
        // App.quotes): only the addresses moved
        "/appload": "/appload",
        "/appload/[section]": "/appload/[section]",
        "/appload/details/[orderId]": {
            pt: "/appload/detalhes/[orderId]"
        },
        "/appload/quotes": {
            pt: "/appload/cotacoes"
        },
        "/map": {
            pt: "/mapa"
        },
        "/analytics": {
            pt: "/analises"
        },
        "/notifications": {
            pt: "/notificacoes"
        },
        "/settings": {
            pt: "/definicoes"
        },
        "/onboarding": {
            pt: "/registo-empresa"
        },
        "/sign-in": {
            pt: "/iniciar-sessao"
        },
        "/sign-up": {
            pt: "/criar-conta"
        },
        "/forgot-password": {
            pt: "/recuperar-palavra-passe"
        },
        "/reset-password": {
            pt: "/redefinir-palavra-passe"
        },
        "/verify-email": {
            pt: "/verificar-email"
        },
        "/accept-invitation/[id]": {
            pt: "/aceitar-convite/[id]"
        }
    },
});
