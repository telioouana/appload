import { notFound } from "next/navigation"
import { Analytics } from "@vercel/analytics/next"
import { Geist_Mono, Montserrat } from "next/font/google"

import { ThemeProvider } from "@workspace/ui/customs/theme-provider"

import "@workspace/ui/globals.css"
import { cn } from "@workspace/ui/lib/utils"
import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import { routing } from "@/i18n/routing"
import { NextIntlClientProvider, hasLocale } from "@workspace/i18n"
import { getTranslations } from "@workspace/i18n/server"
import { EdgeStoreProvider } from "@workspace/edgestore/client"
import { TRPCReactProvider } from "@/backend/api/client"

// Every page title flows through this template, so a tab reads
// "Orders — Appload Enterprise"; pages that set no title of their own fall
// back to the default. The portal is behind a login, so there is no SEO
// here — the titles are for the partner's tab strip and history.
export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params
    const t = await getTranslations({ locale, namespace: "App.metadata" })

    return {
        title: {
            template: `%s — ${t("title")}`,
            default: t("title"),
        },
        description: t("description"),
    }
}

const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", })
const montserratSans = Montserrat({ subsets: ["latin"], variable: "--font-sans" })

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
                fontMono.variable,
                "font-sans",
                montserratSans.variable,
                // The UI kit's headings read --font-heading; the portal has
                // no display face, so headings use the body face
                "[--font-heading:var(--font-sans)]",
            )}
        >
            {/* The app is viewport-locked: pages scroll internally, never the body */}
            <body className="h-svh overflow-hidden">
                <ThemeProvider>
                    <TooltipProvider>
                        <NextIntlClientProvider>
                            <TRPCReactProvider>
                                <EdgeStoreProvider>
                                    <Analytics />
                                    <Toaster />
                                    {children}
                                </EdgeStoreProvider>
                            </TRPCReactProvider>
                        </NextIntlClientProvider>
                    </TooltipProvider>
                </ThemeProvider>
            </body>
        </html>
    )
}
