import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { SidebarInset, SidebarProvider, SidebarTrigger } from "@workspace/ui/components/sidebar"
import { CommandPaletteProvider } from "@workspace/ui/customs/list/command"

import { Sidenav } from "@/frontend/components/navigation/sidenav"
import { AccessDenied } from "@/frontend/components/access-denied"
import { CommandPalette } from "@/frontend/components/command-palette"

export default async function Layout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
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
                    reports desktop on the server and would flash it away. On a
                    desktop the bar has nothing to hold: notifications live on
                    the rail. */}
                <header className="flex h-12 shrink-0 items-center gap-2 px-2 md:hidden">
                    <SidebarTrigger />
                </header>

                <main className="mx-4 flex-1 min-h-0 flex flex-col overflow-hidden">
                    {/* The shared list header shows its ⌘K hint inside this and
                        nowhere else, so the chip and the palette below it are
                        mounted or absent together */}
                    <CommandPaletteProvider>
                        {children}
                    </CommandPaletteProvider>
                </main>
            </SidebarInset>

            {/* ⌘K search, one instance for the whole portal */}
            <CommandPalette orgType={tenant.orgType} />
        </SidebarProvider>
    )
}
