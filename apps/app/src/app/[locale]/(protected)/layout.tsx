import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { IconBell } from "@tabler/icons-react"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getTranslations } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@workspace/ui/components/sidebar"

import { Sidenav } from "@/frontend/components/navigation/sidenav"
import { AccessDenied } from "@/frontend/components/access-denied"

export default async function Layout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    const t = await getTranslations("App.shell")

    // proxy.ts only checks that a session cookie exists; this is the first
    // point that validates it. Layouts don't re-run on soft navigation, so
    // the tRPC gates remain the authoritative check per request — this gate
    // keeps the portal shell (nav, route names) from rendering for anyone
    // who is not a live member of an open organization.
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    // The gate order of plan §4, in the order the reasons are produced:
    // account type → ban → verified email → membership → open organization
    if (tenant.reason === "NOT_PARTNER_ACCOUNT") return <AccessDenied />
    if (tenant.reason === "BANNED") return <AccessDenied reason="closed" />

    if (tenant.reason === "EMAIL_UNVERIFIED") {
        redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}`)
    }

    if (tenant.reason === "NO_ORGANIZATION") redirect("/onboarding")

    if (!tenant.ok) return <AccessDenied reason="closed" />

    return (
        <SidebarProvider className="h-svh">
            <Sidenav orgType={tenant.orgType} />
            {/* The inset variant adds m-2 around this main area; the flex chain
                absorbs it so children sized h-full stay within the viewport */}
            <SidebarInset className="min-h-0">
                {/* Under `md` the nav is an off-canvas sheet that opens for
                    nobody: the rail is display:none there and the keyboard
                    shortcut is no help on a phone. The trigger is its only
                    handle, gated in CSS rather than on `useIsMobile`, which
                    reports desktop on the server and would flash it away. */}
                <header className="flex h-12 shrink-0 items-center gap-2 px-2">
                    <SidebarTrigger className="md:hidden" />

                    {/* Placeholder for the notification centre (M6): the bell
                        has its seat in the header from the first release, so
                        wiring it later moves nothing else */}
                    <span
                        className="ml-auto inline-flex size-9 items-center justify-center rounded-full text-muted-foreground/60"
                        aria-hidden="true"
                    >
                        <IconBell className="size-5" stroke={1.5} />
                    </span>
                    <span className="sr-only">{t("notifications")}</span>
                </header>

                <main className="mx-4 flex-1 min-h-0 flex flex-col overflow-hidden">
                    {children}
                </main>
            </SidebarInset>
        </SidebarProvider>
    )
}
