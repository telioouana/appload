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
        "/fleet/[kind]": {
            pt: "/frota/[kind]"
        },
        "/drivers": {
            pt: "/motoristas"
        },
        // Appload's brokerage: requests, offers, standing quotes and the
        // orders Appload books, beside the company's own loads rather than
        // mixed into them. Static segments sit beside the dynamic one, as in
        // the admin — two sibling dynamic segments are not allowed, and a
        // static one wins the match. The code behind these pages is still
        // named `orders` and `quotes` (frontend/pages, App.orders,
        // App.quotes): only the addresses moved
        "/appload/[section]": "/appload/[section]",
        "/appload/details/[orderId]": {
            pt: "/appload/detalhes/[orderId]"
        },
        "/appload/quotes": {
            pt: "/appload/cotacoes"
        },
        "/trips": {
            pt: "/viagens"
        },
        "/trips/[tripId]": {
            pt: "/viagens/[tripId]"
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
