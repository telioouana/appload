import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
    // A list of all locales that are supported
    locales: ["pt", "en"],

    // Used when no locale matches
    defaultLocale: "pt",

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
        "/orders/details/[orderId]": {
            pt: "/pedidos/detalhes/[orderId]"
        },
        "/chats": {
            pt: "/conversas"
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

