import Image from "next/image"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { getTranslations } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { AccessDenied } from "@/frontend/components/access-denied"
import { LocaleSwitcher } from "@/frontend/components/locale-switcher"

/**
 * The half-way house: a verified partner account with no company yet. The
 * first three gates of the tenant order apply here (account type, ban,
 * verified email); the fourth — membership — is the one this group exists to
 * fill, so a member is sent straight on to the shell.
 */
export default async function OnboardingLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    const t = await getTranslations("General")

    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (tenant.reason === "NOT_PARTNER_ACCOUNT") return <AccessDenied />
    if (tenant.reason === "BANNED") return <AccessDenied reason="closed" />

    if (!tenant.emailVerified) {
        redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}`)
    }

    if (tenant.organizationId) redirect("/dashboard")

    return (
        <div className="flex h-svh flex-col overflow-y-auto">
            <header className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
                <div className="flex items-center gap-2">
                    <Image src="/logos/logo-unlabel.svg" alt={t("app-name")} width={32} height={32} className="size-8" unoptimized />
                    <span className="font-semibold tracking-wide">{t("app-name")}</span>
                </div>

                {/* NavUser belongs to the sidebar (it reads its context), so
                    the way out of this screen is the sign-out line the view
                    puts under the card */}
                <LocaleSwitcher />
            </header>

            <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
                {children}
            </main>
        </div>
    )
}
