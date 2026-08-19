"use client"

import { IconShieldLock, IconUser } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { authClient } from "@workspace/auth/client"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { AccountCard } from "../components/account-card"
import { PasswordCard } from "../components/password-card"
import { useSignInMethods } from "../hooks/use-sign-in-methods"
import { SignInMethodsCard } from "../components/sign-in-methods-card"

/**
 * The signed-in user's own settings — not user administration, which lives
 * with the partner pages.
 *
 * Everything here writes through `authClient` straight to Better Auth, so
 * there is no tRPC prefetch to hydrate and the page is client-rendered off
 * the session. Split in two tabs because identity and credentials are read
 * for different reasons and rarely in the same sitting.
 */
export function SettingsView() {
    const t = useTranslations("Admin.settings")

    const { data: session, isPending } = authClient.useSession()

    // Shares one query with the methods card, so a new password immediately
    // reveals the cards that depend on having one
    const { hasPassword } = useSignInMethods()

    if (isPending) return <SettingsSkeleton />

    // The route is inside (protected), so a missing session means the
    // redirect is already in flight — render nothing rather than an error
    if (!session) return null

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h1 className="font-heading text-2xl font-bold tracking-tight">{t("title")}</h1>
                <p className="text-muted-foreground text-sm">{t("description")}</p>
            </div>

            <Tabs defaultValue="account" className="gap-4">
                <TabsList>
                    <TabsTrigger value="account">
                        <IconUser />
                        {t("tabs.account")}
                    </TabsTrigger>
                    <TabsTrigger value="security">
                        <IconShieldLock />
                        {t("tabs.security")}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="account" className="flex flex-col gap-4">
                    <AccountCard user={session.user} />
                </TabsContent>

                <TabsContent value="security" className="flex flex-col gap-4">
                    <SignInMethodsCard user={session.user} />

                    {/* changePassword needs a current password, so this card
                        only makes sense once a credential account exists —
                        the methods card owns creating the first one */}
                    {hasPassword && <PasswordCard />}

                    {/* TwoFactorCard and PhoneCard are intentionally not
                        rendered for v1: the /2fa challenge page does not
                        exist yet (enabling TOTP would lock the user out at
                        next credential sign-in) and phone OTP has no SMS
                        provider wired. Both components are finished — mount
                        them here once those gaps close. */}
                </TabsContent>
            </Tabs>
        </div>
    )
}

// Mirrors the real layout so the page does not jump once the session lands
function SettingsSkeleton() {
    return (
        <div className="flex flex-col gap-4">
            <Skeleton className="h-9 w-48 rounded-2xl" />
            <Skeleton className="h-10 w-64 rounded-2xl" />
            <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
    )
}
