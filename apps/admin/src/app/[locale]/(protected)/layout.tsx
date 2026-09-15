import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getStaffGates } from "@workspace/trpc/staff-gate"

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
    // keeps the admin shell (nav, route names) from rendering for non-staff.
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const staff = await getStaffGates(db, { userId: session.user.id })

    if (!staff.isStaff) return <AccessDenied />

    return (
        <SidebarProvider className="h-svh">
            <Sidenav />
            {/* The inset variant adds m-2 around this main area; the flex chain
                absorbs it so children sized h-full stay within the viewport */}
            <SidebarInset className="min-h-0">
                {/* Under `md` the nav is an off-canvas sheet that opens for
                    nobody: the rail is display:none there and the keyboard
                    shortcut is no help on a phone. This is its only handle.
                    Gated in CSS rather than on `useIsMobile`, which reports
                    desktop on the server and would flash the button away. */}
                <header className="flex h-12 shrink-0 items-center px-2 md:hidden">
                    <SidebarTrigger />
                </header>

                <main className="mx-4 flex-1 min-h-0 flex flex-col overflow-hidden">
                    {/* The shared list header shows its ⌘K hint inside this and
                        nowhere else — the portal mounts no palette, so it never
                        advertises a shortcut that does nothing */}
                    <CommandPaletteProvider>
                        {children}
                    </CommandPaletteProvider>
                </main>
            </SidebarInset>

            {/* ⌘K search, one instance for the whole admin */}
            <CommandPalette />
        </SidebarProvider>
    )
}
