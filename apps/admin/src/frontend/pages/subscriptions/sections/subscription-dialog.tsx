"use client"

import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconCheck, IconRefresh } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import { SUBSCRIPTION_PLAN } from "@workspace/db/types"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { SelectItem } from "@workspace/ui/components/select"
import { FieldGroup } from "@workspace/ui/components/field"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@workspace/ui/components/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { SelectInput } from "@workspace/ui/inputs/select"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@workspace/trpc/errors"
import { IdentityCell, initials } from "@workspace/ui/customs/list/table-cells"
import { changedExpiry, extendedExpiry, MONTH_OPTIONS, type SubscriptionRow } from "@/frontend/pages/subscriptions/types"

const ERROR_CODES = ["NOT_ALLOWED", "NOT_FOUND", "UNKNOWN"] as const
type ErrorCode = (typeof ERROR_CODES)[number]

// The select speaks strings; the months go to the server as a number
const MONTH_VALUES = MONTH_OPTIONS.map(String) as [string, ...string[]]

const schema = z.object({
    plan: z.enum(SUBSCRIPTION_PLAN),
    months: z.enum(MONTH_VALUES),
})

type Values = z.infer<typeof schema>

type Candidate = { id: string; name: string; logo: string | null; type: string }

/** A row to edit, or "new" to pick an organization that has no plan yet. */
export type DialogSubject = SubscriptionRow | "new" | null

/**
 * The one place a plan is written, as explicit actions so nothing happens by
 * accident: a new company gets its first plan and months; an existing one
 * changes tier (now, the end date stays), renews (paid months added to the
 * end date) or cancels (runs to the paid end date, then ends). Plans are paid
 * by the month, never open-ended, and a subscription never loses its plan
 * from here, so the row stays on the page as history.
 */
export function SubscriptionDialog({ subject, onOpenChange }: { subject: DialogSubject; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations("Admin.subscriptions")
    const f = useFormatter()
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const row = subject !== "new" ? subject : null
    const [candidate, setCandidate] = useState<Candidate | null>(null)
    const [error, setError] = useState<ErrorCode | null>(null)

    const values = useMemo<Values>(
        () => ({ plan: row?.plan ?? "starter", months: "1" }),
        [row],
    )

    const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: values })

    useEffect(() => {
        form.reset(values)
    }, [values, form])

    const save = useMutation(trpc.organizations.setSubscription.mutationOptions({
        onSuccess: () => Promise.all([
            queryClient.invalidateQueries({ queryKey: trpc.subscriptions.pathKey() }),
            queryClient.invalidateQueries({ queryKey: trpc.partners.pathKey() }),
        ]),
    }))

    // Every way out of the dialog goes through here, so a failed attempt
    // never greets the next one
    const close = () => {
        setError(null)
        setCandidate(null)
        onOpenChange(false)
    }

    type Action = Parameters<typeof save.mutateAsync>[0]

    const write = async (action: Action, done: "started" | "changed" | "renewed" | "cancelled") => {
        setError(null)

        try {
            await save.mutateAsync(action)
            toast(t(`dialog.${done}`))
            close()
        } catch (caught) {
            setError(domainErrorCode<ErrorCode>(caught, ERROR_CODES, "UNKNOWN"))
        }
    }

    const start = (next: Values) => {
        if (!candidate) return
        return write({ action: "start", id: candidate.id, plan: next.plan, months: Number(next.months) }, "started")
    }

    const plan = form.watch("plan")
    const months = Number(form.watch("months"))
    const date = (value: Date) => f.dateTime(value, { day: "2-digit", month: "long", year: "numeric" })

    // The same arithmetic the server applies, shown before the save: a
    // renewal counts from the current end date while that is still ahead
    const running = row?.expiresAt && row.expiresAt > new Date() ? row.expiresAt : null
    const renewedUntil = date(extendedExpiry(running, months))
    // What is left of the current tier, as time on the picked one; null when
    // the end date would not move (same tier, nothing left, or a price agreed
    // per customer)
    const movedTo = row && running && plan !== row.plan ? changedExpiry(running, row.plan, plan) : null
    const changeHint = !running
        ? t("dialog.change-hint-expired")
        : row && movedTo && movedTo.getTime() !== running.getTime()
            ? t("dialog.change-hint-moved", { from: t(`plan.${row.plan}`), to: t(`plan.${plan}`), date: date(movedTo) })
            : t("dialog.change-hint", { date: date(running) })

    return (
        <Dialog open={subject !== null} onOpenChange={(next) => { if (!save.isPending && !next) close() }}>
            <DialogContent className="w-full sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{row ? t("dialog.title", { name: row.name }) : t("dialog.new-title")}</DialogTitle>
                    <DialogDescription>{t("dialog.description")}</DialogDescription>
                </DialogHeader>

                {subject === "new" && (
                    candidate
                        ? (
                            <div className="flex items-center justify-between gap-3">
                                <IdentityCell image={candidate.logo} fallback={initials(candidate.name)} name={candidate.name} sub={t(`filters.type-options.${candidate.type === "carrier" ? "carrier" : "shipper"}`)} />
                                <Button variant="ghost" size="sm" onClick={() => setCandidate(null)} disabled={save.isPending}>
                                    {t("dialog.change-company")}
                                </Button>
                            </div>
                        )
                        : <CandidatePicker onPick={setCandidate} />
                )}

                {subject === "new" ? (
                    <form
                        id="subscription-form"
                        onSubmit={(event) => {
                            event.stopPropagation()
                            void form.handleSubmit(start)(event)
                        }}
                    >
                        <FieldGroup className="gap-4">
                            <SelectInput name="plan" control={form.control} isPending={save.isPending} label={t("dialog.plan")}>
                                {SUBSCRIPTION_PLAN.map((tier) => (
                                    <SelectItem key={tier} value={tier}>{t(`plan.${tier}`)}</SelectItem>
                                ))}
                            </SelectInput>

                            <SelectInput
                                name="months"
                                control={form.control}
                                isPending={save.isPending}
                                label={t("dialog.months")}
                                description={t("dialog.valid-until", { date: renewedUntil })}
                            >
                                {MONTH_VALUES.map((value) => (
                                    <SelectItem key={value} value={value}>{t("dialog.months-option", { months: Number(value) })}</SelectItem>
                                ))}
                            </SelectInput>
                        </FieldGroup>
                    </form>
                ) : row && (
                    <FieldGroup className="gap-6">
                        <div className="flex flex-col gap-2">
                            <SelectInput
                                name="plan"
                                control={form.control}
                                isPending={save.isPending}
                                label={t("dialog.plan")}
                                description={changeHint}
                            >
                                {SUBSCRIPTION_PLAN.map((tier) => (
                                    <SelectItem key={tier} value={tier}>{t(`plan.${tier}`)}</SelectItem>
                                ))}
                            </SelectInput>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="self-end"
                                disabled={save.isPending || plan === row.plan}
                                onClick={() => void write({ action: "change", id: row.id, plan }, "changed")}
                            >
                                {t("dialog.change-plan")}
                            </Button>
                        </div>

                        <div className="flex flex-col gap-2">
                            <SelectInput
                                name="months"
                                control={form.control}
                                isPending={save.isPending}
                                label={t("dialog.months")}
                                description={
                                    <span className="flex flex-col gap-1">
                                        <span>{t("dialog.valid-until", { date: renewedUntil })}</span>
                                        {row.cancelledAt && <span>{t("dialog.renew-uncancel")}</span>}
                                    </span>
                                }
                            >
                                {MONTH_VALUES.map((value) => (
                                    <SelectItem key={value} value={value}>{t("dialog.months-option", { months: Number(value) })}</SelectItem>
                                ))}
                            </SelectInput>
                            <Button
                                type="button"
                                size="sm"
                                className="self-end"
                                disabled={save.isPending}
                                onClick={() => void write({ action: "renew", id: row.id, months }, "renewed")}
                            >
                                <IconRefresh className="size-4" stroke={1.5} />
                                {t("dialog.renew")}
                            </Button>
                        </div>

                        {running && (
                            <p className="text-muted-foreground text-[13px]">
                                {row.cancelledAt
                                    ? t("dialog.cancelled-on", { date: date(row.cancelledAt), until: date(running) })
                                    : (
                                        <>
                                            {t("dialog.cancel-hint", { date: date(running) })}{" "}
                                            <button
                                                type="button"
                                                className="hover:text-foreground cursor-pointer underline underline-offset-2"
                                                disabled={save.isPending}
                                                onClick={() => void write({ action: "cancel", id: row.id }, "cancelled")}
                                            >
                                                {t("dialog.cancel-subscription")}
                                            </button>
                                        </>
                                    )}
                            </p>
                        )}
                    </FieldGroup>
                )}

                {error && <Alert variant="destructive"><AlertDescription>{t(`errors.${error}`)}</AlertDescription></Alert>}

                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={close} disabled={save.isPending}>
                        {row ? t("dialog.close") : t("dialog.cancel")}
                    </Button>
                    {subject === "new" && (
                        <Button type="submit" form="subscription-form" disabled={save.isPending || !candidate}>
                            {save.isPending ? <Spinner /> : <IconCheck className="size-4" stroke={1.5} />}
                            {t("dialog.start")}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** Organizations without a plan, matched as the reader types. */
function CandidatePicker({ onPick }: { onPick: (candidate: Candidate) => void }) {
    const t = useTranslations("Admin.subscriptions")
    const trpc = useTRPC()

    const [search, setSearch] = useState("")
    // Deferred, so the query key only moves once typing settles
    const term = useDeferredValue(search)

    const candidates = useQuery(trpc.subscriptions.candidates.queryOptions({ search: term }))

    return (
        <Command shouldFilter={false} className="ring-foreground/5 rounded-xl ring-1">
            <CommandInput value={search} onValueChange={setSearch} placeholder={t("dialog.company-placeholder")} />
            <CommandList className="max-h-56">
                {candidates.isPending
                    ? <div className="flex justify-center py-4"><Spinner /></div>
                    : <CommandEmpty>{t("dialog.no-candidates")}</CommandEmpty>}
                {candidates.data?.map((candidate) => (
                    <CommandItem key={candidate.id} value={candidate.id} onSelect={() => onPick(candidate)}>
                        <IdentityCell
                            size="sm"
                            image={candidate.logo}
                            fallback={initials(candidate.name)}
                            name={candidate.name}
                            sub={t(`filters.type-options.${candidate.type === "carrier" ? "carrier" : "shipper"}`)}
                        />
                    </CommandItem>
                ))}
            </CommandList>
        </Command>
    )
}
