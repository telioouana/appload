"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useTranslations } from "@workspace/i18n";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@workspace/auth/client";

import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";

import { useTRPC } from "@/backend/api/client";
import { NuitStep } from "@/frontend/pages/onboarding/sections/nuit-step";
import { CreateCompanyForm } from "@/frontend/pages/onboarding/sections/create-company-form";
import { AlreadyClaimedCard, ClaimCard, PendingClaimCard } from "@/frontend/pages/onboarding/sections/claim-cards";
import type { NuitLookup } from "@/frontend/pages/onboarding/server/procedures";

/**
 * Everything between a verified account and a tenant: find the company by
 * NUIT, then register it or ask to own it. The company type is never asked
 * for — it is the account's own, chosen at sign-up.
 */
export function OnboardingView() {
    const t = useTranslations("App.onboarding")
    const trpc = useTRPC()
    const router = useRouter()

    const [found, setFound] = useState<{ nuit: string; result: NuitLookup } | null>(null)

    const { data: status, isPending, refetch } = useQuery(trpc.onboarding.status.queryOptions())

    // Joining is what makes the cookie's organization stale, so it is
    // refreshed before the shell is asked to render for the new tenant
    async function enter(organizationId: string) {
        await authClient.organization.setActive({ organizationId })
        router.push("/dashboard")
    }

    if (isPending || !status) {
        return (
            <div className="grid gap-4">
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-64 w-full rounded-xl" />
            </div>
        )
    }

    return (
        <div className="grid gap-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="font-heading text-2xl font-bold tracking-tight">{t("title")}</h1>
                <Badge variant="outline">
                    {t("type.label")}: {t(`type.${status.user.type}`)}
                </Badge>
            </div>

            {status.pendingClaim ? (
                <PendingClaimCard
                    organizationName={status.pendingClaim.organizationName}
                    createdAt={status.pendingClaim.createdAt}
                />
            ) : found === null ? (
                <NuitStep onFound={setFound} />
            ) : found.result.organization === null ? (
                <CreateCompanyForm
                    nuit={found.nuit}
                    onBack={() => setFound(null)}
                    onRegistered={enter}
                />
            ) : found.result.hasMembers ? (
                <AlreadyClaimedCard
                    organization={found.result.organization}
                    onBack={() => setFound(null)}
                />
            ) : (
                <ClaimCard
                    organization={found.result.organization}
                    emailMatches={found.result.emailMatches}
                    onBack={() => setFound(null)}
                    onApproved={enter}
                    // A queued claim becomes the pending card above, which
                    // the status query is what knows about
                    onQueued={() => {
                        setFound(null)
                        void refetch()
                    }}
                />
            )}

            {/* The only account control this screen needs: whoever is signed
                in is who the company will belong to */}
            <p className="text-center text-sm text-muted-foreground">
                {t("signed-in", { email: status.user.email })}{" "}
                <button
                    type="button"
                    className="text-foreground underline-offset-4 hover:underline"
                    onClick={() => authClient.signOut({
                        fetchOptions: { onSuccess: () => router.push("/sign-in") },
                    })}
                >
                    {t("sign-out")}
                </button>
            </p>
        </div>
    )
}
