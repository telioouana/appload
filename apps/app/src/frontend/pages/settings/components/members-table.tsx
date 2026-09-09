"use client"

import { toast } from "sonner";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IconAlertCircle, IconDotsVertical, IconUserOff } from "@tabler/icons-react";

import { authClient } from "@workspace/auth/client";
import { useFormatter, useTranslations } from "@workspace/i18n";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@workspace/ui/components/alert-dialog";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { InviteMemberDialog } from "@/frontend/pages/settings/components/invite-member-dialog";
import { membersKey, useMembers, type OrgMember } from "@/frontend/pages/settings/hooks/use-organization";
import type { MeSession } from "@/frontend/pages/settings/server/procedures";

type Role = "owner" | "admin" | "member"

const ROLES: Role[] = ["owner", "admin", "member"]

// `member.role` is free-form text (the plugin allows comma-separated roles);
// anything outside the portal's three falls back to the least privileged
function roleKey(role: string): Role {
    const first = role.split(",")[0]?.trim()

    return first === "owner" || first === "admin" ? first : "member"
}

/**
 * Who from this company can sign in to the portal. Members see the list;
 * only owners and admins act on it — and the plugin re-checks every one of
 * these rules server-side (an owner may only be touched by another owner,
 * and the last owner may not be demoted or removed at all).
 */
export function MembersTable({
    organizationId,
    organizationName,
    viewerId,
    viewerRole,
}: {
    organizationId: string
    organizationName: string
    viewerId: string
    viewerRole: MeSession["role"]
}) {
    const t = useTranslations("App.settings")
    const f = useFormatter()
    const queryClient = useQueryClient()

    const { data, isPending, isError } = useMembers(organizationId)

    const [pendingRemoval, setPendingRemoval] = useState<OrgMember | null>(null)
    const [isWorking, setWorking] = useState(false)

    const canManage = viewerRole === "owner" || viewerRole === "admin"
    const members = data?.members ?? []
    const ownerCount = members.filter((row) => roleKey(row.role) === "owner").length

    async function refresh() {
        await queryClient.invalidateQueries({ queryKey: membersKey(organizationId) })
    }

    async function changeRole(member: OrgMember, role: Role) {
        setWorking(true)

        const { error } = await authClient.organization.updateMemberRole({
            memberId: member.id,
            role,
            organizationId,
        })

        setWorking(false)

        if (error) {
            toast.error(t("members.error"))
            return
        }

        await refresh()
        toast.success(t("members.role-changed"))
    }

    async function remove(member: OrgMember) {
        setWorking(true)

        const { error } = await authClient.organization.removeMember({
            memberIdOrEmail: member.id,
            organizationId,
        })

        setWorking(false)
        setPendingRemoval(null)

        if (error) {
            toast.error(t("members.error"))
            return
        }

        await refresh()
        toast.success(t("members.removed"))
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("members.title")}</CardTitle>
                <CardDescription>{t("members.description")}</CardDescription>

                {canManage && (
                    <CardAction>
                        <InviteMemberDialog
                            organizationId={organizationId}
                            organizationName={organizationName}
                        />
                    </CardAction>
                )}
            </CardHeader>

            <CardContent className="grid gap-4">
                {isPending && (
                    <div className="grid gap-2">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <Skeleton key={index} className="h-12 w-full rounded-xl" />
                        ))}
                    </div>
                )}

                {isError && (
                    <Alert variant="destructive">
                        <IconAlertCircle />
                        <AlertTitle>{t("members.error")}</AlertTitle>
                    </Alert>
                )}

                {!isPending && !isError && (
                    <div className="container-snap overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="h-8 px-2 text-xs font-normal">{t("members.columns.member")}</TableHead>
                                    <TableHead className="h-8 px-2 text-xs font-normal">{t("members.columns.role")}</TableHead>
                                    <TableHead className="hidden h-8 px-2 text-xs font-normal sm:table-cell">{t("members.columns.joined")}</TableHead>
                                    <TableHead className="h-8 w-10 px-2" />
                                </TableRow>
                            </TableHeader>

                            <TableBody>
                                {members.map((member) => {
                                    const role = roleKey(member.role)
                                    const isSelf = member.userId === viewerId
                                    const isLastOwner = role === "owner" && ownerCount <= 1
                                    // Only an owner may touch another owner or
                                    // hand the owner role out
                                    const mayTouch = canManage && !isSelf && (role !== "owner" || viewerRole === "owner")
                                    const roleChanges = mayTouch && !isLastOwner
                                        ? ROLES.filter((next) => next !== role && (next !== "owner" || viewerRole === "owner"))
                                        : []
                                    const mayRemove = mayTouch && !isLastOwner
                                    const label = member.user.name?.trim() || member.user.email

                                    return (
                                        <TableRow key={member.id}>
                                            <TableCell className="px-2">
                                                <div className="flex items-center gap-3">
                                                    <Avatar>
                                                        <AvatarImage src={member.user.image ?? undefined} alt={label} />
                                                        <AvatarFallback>{initials(label)}</AvatarFallback>
                                                    </Avatar>

                                                    <div className="grid min-w-0">
                                                        <span className="flex items-center gap-2 truncate text-sm font-medium">
                                                            {label}
                                                            {isSelf && (
                                                                <Badge variant="outline" className="text-[10px]">
                                                                    {t("members.you")}
                                                                </Badge>
                                                            )}
                                                        </span>
                                                        <span className="text-muted-foreground truncate text-xs">
                                                            {member.user.email}
                                                        </span>
                                                    </div>
                                                </div>
                                            </TableCell>

                                            <TableCell className="px-2">
                                                <Badge variant={role === "member" ? "secondary" : "default"}>
                                                    {t(`members.roles.${role}`)}
                                                </Badge>
                                            </TableCell>

                                            <TableCell className="text-muted-foreground hidden px-2 text-sm sm:table-cell">
                                                {f.dateTime(member.createdAt, { day: "2-digit", month: "short", year: "numeric" })}
                                            </TableCell>

                                            <TableCell className="px-2 text-right">
                                                {roleChanges.length > 0 || mayRemove ? (
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="size-8"
                                                                disabled={isWorking}
                                                                aria-label={t("members.actions")}
                                                            >
                                                                <IconDotsVertical className="size-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>

                                                        <DropdownMenuContent align="end" className="w-56">
                                                            {roleChanges.map((next) => (
                                                                <DropdownMenuItem
                                                                    key={next}
                                                                    onClick={() => changeRole(member, next)}
                                                                >
                                                                    {t(`members.promote.${next}`)}
                                                                </DropdownMenuItem>
                                                            ))}

                                                            {roleChanges.length > 0 && mayRemove && <DropdownMenuSeparator />}

                                                            {mayRemove && (
                                                                <DropdownMenuItem
                                                                    variant="destructive"
                                                                    onClick={() => setPendingRemoval(member)}
                                                                >
                                                                    <IconUserOff />
                                                                    {t("members.remove")}
                                                                </DropdownMenuItem>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                ) : isLastOwner ? (
                                                    <span className="text-muted-foreground text-xs">{t("members.last-owner")}</span>
                                                ) : null}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>

                        {members.length <= 1 && (
                            <p className="text-muted-foreground px-2 py-3 text-sm">{t("members.empty")}</p>
                        )}
                    </div>
                )}

                {!canManage && (
                    <p className="text-muted-foreground text-xs">{t("members.read-only")}</p>
                )}
            </CardContent>

            <AlertDialog
                open={pendingRemoval !== null}
                onOpenChange={(next) => { if (!next && !isWorking) setPendingRemoval(null) }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t("members.remove-dialog.title", {
                                name: pendingRemoval?.user.name?.trim() || pendingRemoval?.user.email || "",
                            })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>{t("members.remove-dialog.description")}</AlertDialogDescription>
                    </AlertDialogHeader>

                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isWorking}>{t("members.remove-dialog.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isWorking}
                            onClick={(event) => {
                                // The dialog closes on click by default; the
                                // request decides when this one goes away
                                event.preventDefault()
                                if (pendingRemoval) void remove(pendingRemoval)
                            }}
                        >
                            {t("members.remove-dialog.confirm")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    )
}

function initials(label: string) {
    return label
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
}
