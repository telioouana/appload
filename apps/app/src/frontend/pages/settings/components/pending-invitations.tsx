"use client"

import { toast } from "sonner";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IconAlertCircle, IconX } from "@tabler/icons-react";

import { authClient } from "@workspace/auth/client";
import { useFormatter, useNow, useTranslations } from "@workspace/i18n";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { invitationsKey, useInvitations } from "@/frontend/pages/settings/hooks/use-organization";

// Invitations are created with these two roles only (see the invite dialog);
// anything else came from Admin and is shown as it is stored
function roleKey(role: string): "owner" | "admin" | "member" {
    const first = role.split(",")[0]?.trim()

    return first === "owner" || first === "admin" ? first : "member"
}

/** Invitations sent and not yet accepted, with the way to take one back. */
export function PendingInvitations({
    organizationId,
    canManage,
}: {
    organizationId: string
    canManage: boolean
}) {
    const t = useTranslations("App.settings")
    const f = useFormatter()
    const now = useNow()
    const queryClient = useQueryClient()

    const { data, isPending, isError } = useInvitations(organizationId)

    const [cancelling, setCancelling] = useState<string | null>(null)

    async function cancel(invitationId: string) {
        setCancelling(invitationId)

        const { error } = await authClient.organization.cancelInvitation({ invitationId })

        setCancelling(null)

        if (error) {
            toast.error(t("invitations.error"))
            return
        }

        await queryClient.invalidateQueries({ queryKey: invitationsKey(organizationId) })
        toast.success(t("invitations.cancelled"))
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("invitations.title")}</CardTitle>
                <CardDescription>{t("invitations.description")}</CardDescription>
            </CardHeader>

            <CardContent>
                {isPending && <Skeleton className="h-12 w-full rounded-xl" />}

                {isError && (
                    <Alert variant="destructive">
                        <IconAlertCircle />
                        <AlertTitle>{t("invitations.error")}</AlertTitle>
                    </Alert>
                )}

                {!isPending && !isError && (data?.length ?? 0) === 0 && (
                    <p className="text-muted-foreground text-sm">{t("invitations.empty")}</p>
                )}

                {!isPending && !isError && (data?.length ?? 0) > 0 && (
                    <div className="container-snap overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="h-8 px-2 text-xs font-normal">{t("invitations.columns.email")}</TableHead>
                                    <TableHead className="h-8 px-2 text-xs font-normal">{t("invitations.columns.role")}</TableHead>
                                    <TableHead className="hidden h-8 px-2 text-xs font-normal sm:table-cell">{t("invitations.columns.expires")}</TableHead>
                                    <TableHead className="h-8 w-10 px-2" />
                                </TableRow>
                            </TableHeader>

                            <TableBody>
                                {data?.map((invitation) => (
                                    <TableRow key={invitation.id}>
                                        <TableCell className="px-2 text-sm">{invitation.email}</TableCell>

                                        <TableCell className="px-2">
                                            <Badge variant="secondary">
                                                {t(`members.roles.${roleKey(invitation.role)}`)}
                                            </Badge>
                                        </TableCell>

                                        {/* Better Auth leaves an unaccepted
                                            invitation `pending` past its
                                            expiry, so the date alone would
                                            read as a row somebody can still
                                            act on */}
                                        <TableCell className="text-muted-foreground hidden px-2 text-sm sm:table-cell">
                                            {invitation.expiresAt.getTime() < now.getTime() ? (
                                                <Badge variant="destructive">{t("invitations.expired")}</Badge>
                                            ) : (
                                                f.dateTime(invitation.expiresAt, { day: "2-digit", month: "short", year: "numeric" })
                                            )}
                                        </TableCell>

                                        <TableCell className="px-2 text-right">
                                            {canManage && (
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="size-8"
                                                    disabled={cancelling !== null}
                                                    aria-label={t("invitations.cancel")}
                                                    onClick={() => cancel(invitation.id)}
                                                >
                                                    <IconX className="size-4" />
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
