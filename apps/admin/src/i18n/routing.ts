import { defineRouting } from "@workspace/i18n/routing";

import { LOCALES, DEFAULT_LOCALE } from "@workspace/i18n/locales";

// Admin-owned routing config (each app defines its own; only the locale
// list is shared). The admin keeps locales out of its URLs entirely.
export const routing = defineRouting({
    locales: LOCALES,
    defaultLocale: DEFAULT_LOCALE,

    localeDetection: true,
    localePrefix: "never",

    pathnames: {
        "/": "/",
        "/sign-in": {
            pt: "/iniciar-sessao"
        },
        "/forgot-password": {
            pt: "/recuperar-palavra-passe"
        },
        "/reset-password": {
            pt: "/redefinir-palavra-passe"
        },
        "/orders": {
            pt: "/pedidos"
        },
        "/orders/all": {
            pt: "/pedidos/todos"
        },
        "/orders/prospect": {
            pt: "/pedidos/prospectivas"
        },
        "/orders/booked": {
            pt: "/pedidos/confirmados"
        },
        "/orders/on-going": {
            pt: "/pedidos/em-andamento"
        },
        "/orders/delivered": {
            pt: "/pedidos/completos"
        },
        "/orders/history": {
            pt: "/pedidos/historico"
        },
        "/orders/disputes": {
            pt: "/pedidos/disputas"
        },
        "/orders/details/[orderId]": {
            pt: "/pedidos/detalhes/[orderId]"
        },
        "/chats": {
            pt: "/conversas"
        },
        "/map": {
            pt: "/mapa"
        },
        "/shippers": {
            pt: "/clientes"
        },
        "/carriers/all": {
            pt: "/transportadores/todos"
        },
        "/carriers/drivers": {
            pt: "/transportadores/motoristas"
        },
        "/carriers/fleets": {
            pt: "/transportadores/frotas"
        },
        "/settings": {
            pt: "/definicoes"
        }
    },
});
