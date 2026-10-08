"use client"

import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"
import { authClient } from "@workspace/auth/client"
import { isAuthorized, STAFF_ROLES, type StaffRole } from "@workspace/auth/user-permissions"

import { Alert } from "@workspace/ui/components/alert"
import { Spinner } from "@workspace/ui/components/spinner"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"

import { useStaffRole } from "@/frontend/pages/kyc/sections/document-checklist"

const STAFF_QUERY = ["staff", "list"] as const

// Same fallback as the staff gate: a missing or unknown role is the least
// privileged one
const roleOf = (role: string | null | undefined): StaffRole =>
    role === "admin" || role === "manager" ? role : "user"

/**
 * Staff accounts and their platform role. Reads and writes go straight to
 * Better Auth's admin endpoints, which check `user:list` / `user:set-role`
 * against the same access-control roles as the tRPC gate — only `admin`
 * holds them. The gate reads the role from the database on every request,
 * so a change applies on the person's next action.
 */
export function StaffView() {
    const t = useTranslations("Admin.staff")
    const r = useTranslations("Admin.settings.account.role.options")
    const queryClient = useQueryClient()

    const { data: session, isPending: sessionPending } = authClient.useSession()
    const canSetRole = isAuthorized(useStaffRole(), "user", ["set-role"])

    const { data: staff, isPending, isError } = useQuery({
        queryKey: STAFF_QUERY,
        enabled: canSetRole,
        queryFn: async () => {
            const { data, error } = await authClient.admin.listUsers({
                query: { filterField: "type", filterValue: "appload", sortBy: "name", sortDirection: "asc" },
            })
            if (error) throw error
            return data.users
        },
    })

    const setRole = useMutation({
        mutationFn: async ({ userId, role }: { userId: string; name: string; role: StaffRole }) => {
            const { error } = await authClient.admin.setRole({ userId, role })
            if (error) throw error
        },
        onSuccess: (_, { name, role }) => toast(t("saved", { name, role: r(role) })),
        onError: () => toast(t("failed")),
        onSettled: () => queryClient.invalidateQueries({ queryKey: STAFF_QUERY }),
    })

    let body: React.ReactNode
    if (sessionPending || (canSetRole && isPending)) body = <Spinner className="mx-auto my-8" />
    else if (!canSetRole) body = <Alert>{t("forbidden")}</Alert>
    else if (isError || !staff) body = <Alert variant="destructive">{t("load-failed")}</Alert>
    else if (staff.length === 0) body = <p className="text-muted-foreground text-sm">{t("empty")}</p>
    else body = (
        <Card>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("name")}</TableHead>
                            <TableHead>{t("email")}</TableHead>
                            <TableHead className="w-44">{t("role")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {staff.map((member) => {
                            const isSelf = member.id === session?.user.id

                            return (
                                <TableRow key={member.id}>
                                    <TableCell className="font-medium">
                                        {member.name}
                                        {isSelf && <span className="text-muted-foreground"> ({t("you")})</span>}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{member.email}</TableCell>
                                    <TableCell>
                                        <Select
                                            value={roleOf(member.role)}
                                            // Your own row is locked: demoting yourself is the
                                            // one change that could leave nobody able to undo it
                                            disabled={isSelf || setRole.isPending}
                                            onValueChange={(role) =>
                                                setRole.mutate({ userId: member.id, name: member.name, role: role as StaffRole })
                                            }
                                        >
                                            <SelectTrigger size="sm" className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(Object.keys(STAFF_ROLES) as StaffRole[]).map((role) => (
                                                    <SelectItem key={role} value={role}>{r(role)}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    )

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h1 className="font-heading text-2xl font-bold tracking-tight">{t("title")}</h1>
                <p className="text-muted-foreground text-sm">{t("description")}</p>
            </div>
            {body}
        </div>
    )
}
