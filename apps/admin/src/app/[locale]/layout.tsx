import { notFound } from "next/navigation"
import { Analytics } from "@vercel/analytics/next"
import { Geist_Mono, Montserrat } from "next/font/google"

import { ThemeProvider } from "@/components/theme-provider"

import "@workspace/ui/globals.css"
import { cn } from "@workspace/ui/lib/utils"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

import { routing } from "@workspace/i18n/routing"
import { NextIntlClientProvider, hasLocale } from "@workspace/i18n"
import { EdgeStoreProvider } from "@workspace/edgestore/client"
import { TRPCReactProvider } from "@/backend/api/client"

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
