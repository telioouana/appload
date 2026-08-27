import type { NextConfig } from "next"
import createNextIntlPlugin from "@workspace/i18n/plugin"

// en → pt slug map, mirroring src/i18n/routing.ts pathnames. Drives the
// legacy-URL redirects below; keep in sync when adding routes.
const SLUGS: Record<string, string> = {
    "/shipper": "/cliente",
    "/carrier": "/transportador",
    "/team": "/equipa",
    "/contact": "/contacto",
    "/faq": "/faq",
    "/insurance": "/seguro",
    "/terms-and-conditions": "/termos-e-condicoes",
    "/privacy-policy": "/politica-de-privacidade",
}

const nextConfig: NextConfig = {
    transpilePackages: ["@workspace/ui"],

    // ImageResponse routes read these from the filesystem at request time;
    // declare them so Vercel's output tracing bundles the files
    outputFileTracingIncludes: {
        "/opengraph-image": ["./public/logo-white.svg", "./src/assets/fonts/**"],
        "/icon": ["./public/logo-unlabel.svg"],
        "/apple-icon": ["./public/logo-unlabel.svg"],
    },

    // Single-hop 308s for every URL shape the old deployments used, so
    // indexed links transfer cleanly (next-intl's healing 307s remain the
    // net for anything unlisted):
    // - the pre-2026 site served English slugs under /en and /pt prefixes
    // - the brief localePrefix:"never" era served en slugs unprefixed
    async redirects() {
        return [
            { source: "/pt", destination: "/", permanent: true },
            ...Object.entries(SLUGS).flatMap(([en, pt]) => [
                { source: `/pt${en}`, destination: pt, permanent: true },
                ...(en === pt ? [] : [{ source: en, destination: `/en${en}`, permanent: true }]),
            ]),
        ]
    },
}

const withNextIntl = createNextIntlPlugin()
export default withNextIntl(nextConfig)
