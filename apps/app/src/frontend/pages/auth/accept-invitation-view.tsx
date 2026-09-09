"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconAlertCircle, IconLogout, IconUserCheck } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@workspace/auth/client";

import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent, CardDescription, CardTitle } from "@workspace/ui/components/card";

import { useTRPC } from "@/backend/api/client";
import { SignUpView } from "@/frontend/pages/auth/sign-up-view";

const lower = (value: string) => value.trim().toLowerCase();

/**
 * Where an invitation email lands. Better Auth accepts an invitation only
 * for the signed-in address, so the three cases this page handles are the
 * three the API allows: nobody signed in (create the account on the invited
 * address first), the invited person signed in (accept), and somebody else
 * signed in (say so, offer the way out).
 */
export function AcceptInvitationView({ invitationId }: { invitationId: string }) {
    const t = useTranslations("App.auth")
    const trpc = useTRPC()
    const router = useRouter()

    const [isAccepting, setAccepting] = useState(false)

    const { data: session, isPending: isSessionPending } = authClient.useSession()
    const { data: invitation, isPending, isError } = useQuery({
        ...trpc.onboarding.invitation.queryOptions({ id: invitationId }),
        retry: false,
    })

    if (isPending || isSessionPending) {
        return (
            <Card className="overflow-hidden p-0 shadow-none text-card-foreground md:shadow-xl w-full">
                <CardContent className="flex items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
                    <Spinner />
                    {t("invitation.loading")}
                </CardContent>
            </Card>
        )
    }

    if (isError || !invitation) {
        return <InvitationProblem title={t("invitation.errors.notFound")} />
    }

    if (invitation.expired) {
        return <InvitationProblem title={t("invitation.errors.expired")} />
    }

    if (invitation.status !== "pending") {
        return <InvitationProblem title={t("invitation.errors.settled")} />
    }

    // No session: the invited person needs an account on that exact address
    // before anything can be accepted
    if (!session) {
        return (
            <SignUpView
                invitation={{
                    id: invitationId,
                    email: invitation.email,
                    organizationName: invitation.organizationName,
                    organizationType: invitation.organizationType,
                }}
            />
        )
    }

    if (lower(session.user.email) !== lower(invitation.email)) {
        return (
            <Card className="overflow-hidden p-0 shadow-none text-card-foreground md:shadow-xl w-full">
                <CardContent className="grid gap-6 p-6 md:p-8">
                    <div className="flex flex-col">
                        <CardTitle className="text-2xl font-bold">{t("invitation.mismatch.title")}</CardTitle>
                        <CardDescription className="text-muted-foreground text-balance">
                            {t("invitation.mismatch.description", {
                                invited: invitation.email,
                                current: session.user.email,
                            })}
                        </CardDescription>
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => authClient.signOut()}
                    >
                        <IconLogout />
                        {t("invitation.mismatch.sign-out")}
                    </Button>
                </CardContent>
            </Card>
        )
    }

    async function onAccept() {
        setAccepting(true)

        const { data, error } = await authClient.organization.acceptInvitation({ invitationId })

        if (error) {
            setAccepting(false)
            // An invitation link is not proof of the mailbox: Better Auth
            // refuses to accept one on an unverified address
            toast.error(
                error.code === "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION"
                    ? t("invitation.errors.emailUnverified")
                    : t("invitation.errors.unknown"),
            )
            return
        }

        const organizationId = data?.member?.organizationId

        // The organization cookie cache keeps the previous (empty) value for
        // up to five minutes; setActive is what refreshes it, so the shell
        // opens on the company just joined rather than on onboarding
        if (organizationId) {
            await authClient.organization.setActive({ organizationId })
        }

        router.push("/dashboard")
    }

    return (
        <Card className="overflow-hidden p-0 shadow-none text-card-foreground md:shadow-xl w-full">
            <CardContent className="grid gap-6 p-6 md:p-8">
                <div className="flex flex-col">
                    <CardTitle className="text-2xl font-bold">
                        {t("invitation.title", { organization: invitation.organizationName })}
                    </CardTitle>
                    <CardDescription className="text-muted-foreground text-balance">
                        {t("invitation.signed-in.description", {
                            email: session.user.email,
                            organization: invitation.organizationName,
                        })}
                    </CardDescription>
                </div>

                <Button type="button" onClick={onAccept} disabled={isAccepting}>
                    <IconUserCheck />
                    {isAccepting ? t("invitation.accepting") : t("invitation.accept")}
                </Button>
            </CardContent>
        </Card>
    )
}

function InvitationProblem({ title }: { title: string }) {
    return (
        <Card className="overflow-hidden p-0 shadow-none text-card-foreground md:shadow-xl w-full">
            <CardContent className="p-6 md:p-8">
                <Alert variant="destructive">
                    <IconAlertCircle />
                    <AlertTitle>{title}</AlertTitle>
                </Alert>
            </CardContent>
        </Card>
    )
}
