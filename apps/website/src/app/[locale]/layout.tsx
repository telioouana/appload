import { notFound } from "next/navigation"
import { Analytics } from "@vercel/analytics/next"
import { GoogleAnalytics } from "@next/third-parties/google"
import { Montserrat } from "next/font/google"

import "@workspace/ui/globals.css"
import "@/styles/website.css"
import { cn } from "@workspace/ui/lib/utils"

import { getTranslations } from "@workspace/i18n/server"
import { NextIntlClientProvider, hasLocale } from "@workspace/i18n"

import { routing } from "@/i18n/routing"
import { SITE_URL } from "@/lib/seo"
import { organizationGraph } from "@/lib/json-ld"
import { JsonLd } from "@/components/seo/json-ld"
import { ThemeProvider } from "@/components/theme/theme-provider"
import { SiteHeader } from "@/frontend/components/shell/site-header"
import { SiteFooter } from "@/frontend/components/shell/site-footer"

// Montserrat doubles as the heading face — the ui package's font-heading
// utility reads --font-heading, which apps are expected to define
const montserrat = Montserrat({
    subsets: ["latin"],
    variable: "--font-sans",
})

export function generateStaticParams() {
    return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    const t = await getTranslations({ locale, namespace: "metadata" })

    return {
        metadataBase: new URL(SITE_URL),
        title: {
            template: "%s — Appload",
            default: t("title"),
        },
        description: t("description"),
        verification: {
            // Renders only once the env var is set in Vercel
            google: process.env.GOOGLE_SITE_VERIFICATION,
            other: {
                "facebook-domain-verification": "ybab3wwghht6m1s33i6oe05yq6eqpk",
            },
        },
    }
}

export default async function RootLayout({
    children,
    params,
}: Readonly<{
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
}>) {
    const { locale } = await params;
    if (!hasLocale(routing.locales, locale)) {
        notFound();
    }

    return (
        <html
            lang={locale}
            suppressHydrationWarning
            className={cn(
                "antialiased",
                "font-sans",
                montserrat.variable,
                // font-heading falls back to the same face; declared so the
                // ui package's font-heading utility resolves
                "[--font-heading:var(--font-sans)]",
                // Hide the document scrollbar (scrolling still works)
                "container-snap",
            )}
        >
            <body className="bg-background text-foreground">
                <JsonLd data={organizationGraph()} />
                <ThemeProvider>
                    <NextIntlClientProvider>
                        <SiteHeader />
                        <main>{children}</main>
                        <SiteFooter />
                        <Analytics />
                        {process.env.NEXT_PUBLIC_GA_ID && (
                            <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
                        )}
                    </NextIntlClientProvider>
                </ThemeProvider>
            </body>
        </html>
    )
}
