"use client"

import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconAlertTriangle, IconCheck, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { authClient } from "@workspace/auth/client"
import type { StaffRole } from "@workspace/auth/user-permissions"
import { ORDER_STATUS } from "@workspace/db/types"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Label } from "@workspace/ui/components/label"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useTRPC } from "@/backend/api/client"
import { allowedTransitions, transitionRequirements, type OrderStatus, type TransitionRequirement } from "@workspace/domain/orders/transitions"
import { INTERRUPTED_STATUSES, type OrderRow } from "@/frontend/pages/orders/types"
import type { BulkTransitionResult } from "@/frontend/pages/orders/server/procedures"

// Moves a batch can make: a note is one field for all, a flag is a side
// effect. Evidence, a POD or an admin reversal stay one order at a time.
const BULK_REQUIREMENTS: TransitionRequirement[] = ["note", "flag"]

/**
 * One status change for every selected row that can make it. Targets are
 * worked out client-side from each row's status and route with the same
 * state machine the server re-guards; rows that cannot make the chosen
 * move are listed and skipped, and the server answers row by row.
 */
export function BulkTransitionDialog({
    rows,
    open,
    onClose,
    onDone,
}: {
    rows: OrderRow[]
    open: boolean
    onClose: () => void
    onDone: (results: BulkTransitionResult[]) => void
}) {
    const t = useTranslations("Admin.orders.bulkTransition")
    const tStatus = useTranslations("Admin.orders.header.filters.status.options")
    const tErrors = useTranslations("Admin.orders.transitionDialog.errors")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const { data: session } = authClient.useSession()
    const role: StaffRole =
        session?.user.role === "admin" ? "admin" :
            session?.user.role === "manager" ? "manager" : "user"

    const [target, setTarget] = useState<OrderStatus | undefined>(undefined)
    const [note, setNote] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [results, setResults] = useState<BulkTransitionResult[] | null>(null)

    const { mutateAsync } = useMutation(trpc.orders.bulkTransition.mutationOptions())

    // Interrupted rows resume to a target only the server knows; they are
    // moved from their own sheet
    const { eligible, interrupted } = useMemo(() => ({
        eligible: rows.filter((row) => !INTERRUPTED_STATUSES.includes(row.status)),
        interrupted: rows.filter((row) => INTERRUPTED_STATUSES.includes(row.status)),
    }), [rows])

    const targets = useMemo(() => {
        const perRow = new Map(eligible.map((row) => [
            row.orderId,
            allowedTransitions({ status: row.status, route: row.route, role, resumeStatus: null })
                // Booking needs the whole deal block; never in bulk
                .filter((to) => to !== "booked" && (transitionRequirements(row.status, to) ?? []).every((req) => BULK_REQUIREMENTS.includes(req))),
        ]))

        return ORDER_STATUS
            .map((to) => ({ to, rows: eligible.filter((row) => perRow.get(row.orderId)?.includes(to)) }))
            .filter((entry) => entry.rows.length > 0)
    }, [eligible, role])

    const included = targets.find((entry) => entry.to === target)?.rows ?? []
    const skipped = eligible.filter((row) => !included.some((entry) => entry.orderId === row.orderId))
    const needsNote = target !== undefined && included.some((row) => (transitionRequirements(row.status, target) ?? []).includes("note"))
    const flags = target !== undefined && included.some((row) => (transitionRequirements(row.status, target) ?? []).includes("flag"))
    const ready = target !== undefined && included.length > 0 && (!needsNote || note.trim().length >= 5)

    async function apply() {
        if (!target || !ready || submitting) return
        setSubmitting(true)

        try {
            const { results } = await mutateAsync({
                to: target,
                note: note.trim() || undefined,
                orders: included.map((row) => ({ orderId: row.orderId, expectedVersion: row.version })),
            })

            queryClient.invalidateQueries(trpc.orders.pathFilter())
            for (const row of included) {
                queryClient.invalidateQueries(trpc.order.get.queryFilter({ orderId: row.orderId }))
                queryClient.invalidateQueries(trpc.order.transitionOptions.queryFilter({ orderId: row.orderId }))
            }

            setResults(results)
            onDone(results)
        } finally {
            setSubmitting(false)
        }
    }

    const failed = results?.filter((result) => !result.ok).length ?? 0

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent className="w-full sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description", { count: rows.length })}</DialogDescription>
                </DialogHeader>

                {results ? (
                    <div className="flex flex-col gap-3">
                        <p className="text-sm">{t("done", { ok: results.length - failed, failed })}</p>
                        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
                            {results.map((result) => (
                                <li key={result.orderId} className="flex items-center gap-2">
                                    {result.ok
                                        ? <IconCheck className="size-4 shrink-0 text-emerald-500" stroke={2} />
                                        : <IconX className="text-destructive size-4 shrink-0" stroke={2} />}
                                    <span className="font-mono">{result.orderId}</span>
                                    {!result.ok && (
                                        <span className="text-muted-foreground truncate">
                                            {tErrors.has(result.code) ? tErrors(result.code as never) : tErrors("UNKNOWN")}
                                        </span>
                                    )}
                                    {result.ok && result.warning && <span className="text-muted-foreground text-xs">{t("sheet-warning")}</span>}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : targets.length === 0 ? (
                    <p className="text-muted-foreground py-4 text-sm">{t("no-targets")}</p>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <Label>{t("target")}</Label>
                            <Select value={target} onValueChange={(value) => setTarget(value as OrderStatus)} disabled={submitting}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={t("target-placeholder")} />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                    {targets.map((entry) => (
                                        <SelectItem key={entry.to} value={entry.to}>
                                            {tStatus(entry.to)} · {t("applies-to", { count: entry.rows.length, total: rows.length })}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {flags && (
                            <Alert>
                                <IconAlertTriangle />
                                <AlertDescription>{t("flag-warning")}</AlertDescription>
                            </Alert>
                        )}

                        {needsNote && (
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="bulk-note">{t("note")}</Label>
                                <Textarea
                                    id="bulk-note"
                                    value={note}
                                    rows={3}
                                    maxLength={2000}
                                    onChange={(event) => setNote(event.target.value)}
                                    placeholder={t("note-placeholder")}
                                    disabled={submitting}
                                />
                            </div>
                        )}

                        {target && (skipped.length > 0 || interrupted.length > 0) && (
                            <div className="rounded-xl border p-3 text-sm">
                                <p className="mb-1 font-medium">{t("skipped", { count: skipped.length + interrupted.length })}</p>
                                <ul className="text-muted-foreground flex max-h-32 flex-col gap-0.5 overflow-y-auto text-xs">
                                    {interrupted.map((row) => (
                                        <li key={row.orderId}><span className="font-mono">{row.orderId}</span> · {t("skipped-interrupted")}</li>
                                    ))}
                                    {skipped.map((row) => (
                                        <li key={row.orderId}><span className="font-mono">{row.orderId}</span> · {t("skipped-no-move", { status: tStatus(row.status) })}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                        {results ? t("close") : t("cancel")}
                    </Button>
                    {!results && targets.length > 0 && (
                        <Button type="button" onClick={apply} disabled={!ready || submitting}>
                            {submitting && <Spinner />}
                            {t("apply", { count: included.length })}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
