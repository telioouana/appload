"use client"

import { toast } from "sonner";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertCircle, IconDotsVertical, IconKey, IconUserOff } from "@tabler/icons-react";

import { useFormatter, useTranslations } from "@workspace/i18n";
import { PROFILES, PROFILE_LEVEL, type Profile } from "@workspace/auth/organization-permissions";
import type { OrgType } from "@workspace/trpc/tenant-gate";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@workspace/ui/components/alert-dialog";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { useTRPC } from "@/backend/api/client";
import { InviteMemberDialog } from "@/frontend/pages/settings/components/invite-member-dialog";
import { PermissionsSheet } from "@/frontend/pages/settings/components/permissions-sheet";
import { profileKey } from "@/frontend/pages/settings/lib/profiles";

type Member = { id: string; name: string; email: string }

/**
 * Who from this company can sign in to the portal. Everybody sees the list
 * and their own permissions; somebody with `team:manage` changes the profile
 * of, removes, or edits the permissions of the people below their own level.
 * The team router holds every one of those rules again server-side — the
 * `editable` flag it sends is its own verdict, never worked out here.
 */
export function MembersTable({
    organizationId,
    organizationName,
    orgType,
    viewer,
}: {
    organizationId: string
    organizationName: string
    orgType: OrgType
    viewer: { level: number; canManage: boolean }
}) {
    const t = useTranslations("App.settings")
    const f = useFormatter()
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { data, isPending, isError } = useQuery(trpc.team.members.queryOptions())

    const [pendingRemoval, setPendingRemoval] = useState<Member | null>(null)
    const [sheetFor, setSheetFor] = useState<string | null>(null)

    const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.team.pathKey() })

    const changeProfile = useMutation(trpc.team.changeProfile.mutationOptions({
        onSuccess: async () => {
            await refresh()
            toast.success(t("members.role-changed"))
        },
        onError: () => toast.error(t("members.error")),
    }))
    const remove = useMutation(trpc.team.remove.mutationOptions({
        onSuccess: async () => {
            setPendingRemoval(null)
            await refresh()
            toast.success(t("members.removed"))
        },
        onError: () => {
            setPendingRemoval(null)
            toast.error(t("members.error"))
        },
    }))

    const isWorking = changeProfile.isPending || remove.isPending
    const members = data ?? []
    const label = (profile: Profile) => t(`members.roles.${profileKey(profile, orgType)}`)

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("members.title")}</CardTitle>
                <CardDescription>{t("members.description")}</CardDescription>

                {viewer.canManage && (
                    <CardAction>
                        <InviteMemberDialog
                            organizationId={organizationId}
                            organizationName={organizationName}
                            orgType={orgType}
                            viewerLevel={viewer.level}
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
                                    <TableHead className="h-8 px-2" />
                                </TableRow>
                            </TableHeader>

                            <TableBody>
                                {members.map((member) => {
                                    const name = member.name?.trim() || member.email
                                    // The profiles below the viewer's own level, which the
                                    // server would accept too
                                    const profileChanges = member.editable
                                        ? PROFILES.filter((next) => next !== member.profile && PROFILE_LEVEL[next] < viewer.level)
                                        : []
                                    const lift = member.actingOwner

                                    return (
                                        <TableRow key={member.id}>
                                            <TableCell className="px-2">
                                                <div className="flex items-center gap-3">
                                                    <Avatar>
                                                        <AvatarImage src={member.image ?? undefined} alt={name} />
                                                        <AvatarFallback>{initials(name)}</AvatarFallback>
                                                    </Avatar>

                                                    <div className="grid min-w-0">
                                                        <span className="flex items-center gap-2 truncate text-sm font-medium">
                                                            {name}
                                                            {member.isSelf && (
                                                                <Badge variant="outline" className="text-[10px]">
                                                                    {t("members.you")}
                                                                </Badge>
                                                            )}
                                                        </span>
                                                        <span className="text-muted-foreground truncate text-xs">
                                                            {member.email}
                                                        </span>
                                                    </div>
                                                </div>
                                            </TableCell>

                                            <TableCell className="px-2">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <Badge variant={member.profile === "owner" ? "default" : member.profile === "admin" ? "secondary" : "outline"}>
                                                        {label(member.profile)}
                                                    </Badge>
                                                    {lift?.live && (
                                                        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                                                            {t("members.acting", { date: lift.endsAt ? f.dateTime(lift.endsAt, { day: "numeric", month: "short" }) : "—" })}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </TableCell>

                                            <TableCell className="text-muted-foreground hidden px-2 text-sm sm:table-cell">
                                                {f.dateTime(member.createdAt, { day: "2-digit", month: "short", year: "numeric" })}
                                            </TableCell>

                                            <TableCell className="px-2">
                                                <div className="flex items-center justify-end gap-1">
                                                    {(viewer.canManage || member.isSelf) && (
                                                        <Button size="sm" variant="ghost" onClick={() => setSheetFor(member.id)}>
                                                            <IconKey />
                                                            {t("members.permissions")}
                                                        </Button>
                                                    )}

                                                    {member.editable && (
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
                                                                {profileChanges.map((next) => (
                                                                    <DropdownMenuItem
                                                                        key={next}
                                                                        onClick={() => changeProfile.mutate({ memberId: member.id, profile: next })}
                                                                    >
                                                                        {t("members.change-to", { profile: label(next) })}
                                                                    </DropdownMenuItem>
                                                                ))}

                                                                {profileChanges.length > 0 && <DropdownMenuSeparator />}

                                                                <DropdownMenuItem
                                                                    variant="destructive"
                                                                    onClick={() => setPendingRemoval({ id: member.id, name, email: member.email })}
                                                                >
                                                                    <IconUserOff />
                                                                    {t("members.remove")}
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    )}
                                                </div>
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

                {!viewer.canManage && (
                    <p className="text-muted-foreground text-xs">{t("members.read-only")}</p>
                )}
            </CardContent>

            <PermissionsSheet memberId={sheetFor} orgType={orgType} onClose={() => setSheetFor(null)} />

            <AlertDialog
                open={pendingRemoval !== null}
                onOpenChange={(next) => { if (!next && !isWorking) setPendingRemoval(null) }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t("members.remove-dialog.title", { name: pendingRemoval?.name ?? "" })}
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
                                if (pendingRemoval) remove.mutate({ memberId: pendingRemoval.id })
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
