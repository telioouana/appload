"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { IconArrowLeft, IconCircleCheck, IconClockHour4, IconLock } from "@tabler/icons-react";

import { useFormatter, useTranslations } from "@workspace/i18n";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { useTRPC } from "@/backend/api/client";
import { domainErrorCode } from "@workspace/trpc/errors";
import type { NuitLookup } from "@/frontend/pages/onboarding/server/procedures";

const ERROR_MESSAGE_KEYS = {
    "ALREADY_MEMBER": "alreadyMember",
    "EMAIL_UNVERIFIED": "emailUnverified",
    "ORGANIZATION_HAS_MEMBERS": "hasMembers",
    "CLAIM_PENDING": "claimPending",
    "NOT_FOUND": "notFound",
    "UNKNOWN": "unknown",
} as const;

type ClaimErrorCode = keyof typeof ERROR_MESSAGE_KEYS;

const CLAIM_ERROR_CODES = Object.keys(ERROR_MESSAGE_KEYS) as ClaimErrorCode[];

type FoundOrganization = NonNullable<NuitLookup["organization"]>;

/** The company exists and nobody is on the portal for it yet. */
export function ClaimCard({
    organization,
    emailMatches,
    onBack,
    onApproved,
    onQueued,
}: {
    organization: FoundOrganization;
    /**
     * The account's address is the one Appload has on file for this company,
     * which is exactly what `onboarding.claim` auto-approves on — so this
     * claim is not a request anybody will review, it is the way in.
     */
    emailMatches: boolean;
    onBack: () => void;
    onApproved: (organizationId: string) => void;
    onQueued: () => void;
}) {
    const t = useTranslations("App.onboarding")
    const trpc = useTRPC()

    const [error, setError] = useState<ClaimErrorCode | null>(null)

    const claim = useMutation(trpc.onboarding.claim.mutationOptions())

    function onClaim() {
        setError(null)

        claim.mutate(
            { organizationId: organization.id },
            {
                onSuccess: ({ approved }) =>
                    approved ? onApproved(organization.id) : onQueued(),
                onError: (err) => setError(domainErrorCode(err, CLAIM_ERROR_CODES, "UNKNOWN")),
            },
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("found.claim.title")}</CardTitle>
                <CardDescription>
                    {emailMatches
                        ? t("found.claim.description-match")
                        : t("found.claim.description")}
                </CardDescription>
            </CardHeader>

            <CardContent className="grid gap-4">
                <OrganizationLine organization={organization} />

                {error && (
                    <Alert variant="destructive">
                        <AlertTitle>{t(`errors.${ERROR_MESSAGE_KEYS[error]}`)}</AlertTitle>
                    </Alert>
                )}
            </CardContent>

            <CardFooter className="gap-2">
                <Button type="button" onClick={onClaim} disabled={claim.isPending}>
                    <IconCircleCheck />
                    {claim.isPending
                        ? t("found.claim.submitting")
                        : emailMatches
                            ? t("found.claim.enter")
                            : t("found.claim.submit")}
                </Button>
                <Button type="button" variant="outline" disabled={claim.isPending} onClick={onBack}>
                    <IconArrowLeft />
                    {t("create.back")}
                </Button>
            </CardFooter>
        </Card>
    )
}

/** The company is already run by somebody on the portal. */
export function AlreadyClaimedCard({
    organization,
    onBack,
}: {
    organization: FoundOrganization;
    onBack: () => void;
}) {
    const t = useTranslations("App.onboarding")

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("found.taken.title")}</CardTitle>
                <CardDescription>{t("found.taken.description")}</CardDescription>
            </CardHeader>

            <CardContent>
                <OrganizationLine organization={organization} />
            </CardContent>

            <CardFooter>
                <Button type="button" variant="outline" onClick={onBack}>
                    <IconArrowLeft />
                    {t("create.back")}
                </Button>
            </CardFooter>
        </Card>
    )
}

/** A claim already went to ops and is waiting for an answer. */
export function PendingClaimCard({
    organizationName,
    createdAt,
}: {
    organizationName: string;
    createdAt: Date;
}) {
    const t = useTranslations("App.onboarding")
    const format = useFormatter()

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <IconClockHour4 className="size-5 text-muted-foreground" stroke={1.5} />
                    {t("pending.title")}
                </CardTitle>
                <CardDescription>
                    {t("pending.description", {
                        name: organizationName,
                        date: format.dateTime(createdAt, { dateStyle: "long" }),
                    })}
                </CardDescription>
            </CardHeader>

            <CardContent>
                <p className="text-sm text-muted-foreground">{t("pending.hint")}</p>
            </CardContent>
        </Card>
    )
}

/** The one line the portal may show about a company nobody has been let into. */
function OrganizationLine({ organization }: { organization: FoundOrganization }) {
    const t = useTranslations("App.onboarding")

    return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-4">
            <IconLock className="size-4 text-muted-foreground" stroke={1.5} />
            <span className="font-medium">{organization.name}</span>
            <Badge variant="outline">{t(`type.${organization.type}`)}</Badge>
            {organization.province && (
                <span className="text-sm text-muted-foreground">{organization.province}</span>
            )}
        </div>
    )
}
