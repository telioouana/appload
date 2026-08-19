import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getStaffGates } from "@workspace/trpc/staff-gate"

import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"

import { Sidenav } from "@/frontend/components/navigation/sidenav"
import { AccessDenied } from "@/frontend/components/access-denied"

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
                <main className="mx-4 flex-1 min-h-0 flex flex-col overflow-hidden">
                    {children}
                </main>
            </SidebarInset>
        </SidebarProvider>
    )
}
