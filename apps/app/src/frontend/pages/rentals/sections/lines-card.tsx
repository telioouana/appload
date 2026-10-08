"use client"

import { useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { useQuery } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { IconPlus, IconTrash } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { FieldGroup } from "@workspace/ui/components/field"
import { SelectItem } from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { Dash, PlateChip } from "@workspace/ui/customs/list/table-cells"
import { DateInput } from "@workspace/ui/inputs/date"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { SelectInput } from "@workspace/ui/inputs/select"
import { TextInput } from "@workspace/ui/inputs/text"

import { useTRPC } from "@/backend/api/client"
import { NONE, TYPED } from "@/backend/schemas/movement"
import { useRentalMutations } from "@/frontend/pages/rentals/hooks/use-rental-mutations"
import { isoOf, localDate } from "@/frontend/pages/rentals/lib/dates"
import { rentalErrorKey, type RentalErrorCode } from "@/frontend/pages/rentals/lib/errors"
import type { RentalDetail, RentalLineView } from "@/frontend/pages/rentals/types"
import { useMoney } from "@/frontend/pages/movements/components/badges"

/** The picker value for the owner's own trucks — beside NONE and TYPED from the load form. */
const OWN = "__own"

export const plateOf = (line: RentalLineView) => line.truck?.plate ?? line.truckPlate ?? "—"

/**
 * One row per truck on the rental: who provides it, how many of its days
 * count so far, what its driver said today and what it comes to. The owner
 * adds trucks and removes one that has no day marked yet; whoever provides
 * a truck ends its line when it leaves early.
 */
export function LinesCard({ rental }: { rental: RentalDetail }) {
    const t = useTranslations("App.rentals")
    const f = useFormatter()
    const money = useMoney()
    const { removeLine } = useRentalMutations()

    const [adding, setAdding] = useState(false)
    const [ending, setEnding] = useState<RentalLineView | null>(null)
    const [removing, setRemoving] = useState<RentalLineView | null>(null)

    const { canAddLine, canEndLine } = rental.permissions
    // A member who reads no price counts the days; what they come to is withheld
    const priced = rental.billable !== null
    // A line is removable while nothing was ever said about its days
    const untouched = (line: RentalLineView) =>
        line.billing.standby + line.billing.stopped + line.billing.off === 0 && line.days.every((day) => !day.disputed)

    const head = "h-8 px-2 text-xs font-normal"
    const cell = "px-2 py-2 text-[13px]"

    const todayOf = (line: RentalLineView) =>
        line.today.answer === "yes" ? t("values.today-yes")
            : line.today.answer === "no" ? t("values.today-no")
                : line.today.silent ? t("values.today-silent")
                    : null

    return (
        <>
            <SectionCard
                title={t("detail.trucks")}
                count={rental.lines.length}
                actions={canAddLine ? (
                    <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t("detail.actions.add-line")}
                    </Button>
                ) : undefined}
            >
                {rental.lines.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{t("detail.no-lines")}</p>
                ) : (
                    <div className="container-snap -mx-5 overflow-x-auto px-5 [&_[data-slot=table-container]]:overflow-visible">
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className={head}>{t("detail.line-columns.truck")}</TableHead>
                                    <TableHead className={head}>{t("detail.line-columns.provider")}</TableHead>
                                    <TableHead className={`${head} text-right`}>{t("detail.line-columns.days")}</TableHead>
                                    <TableHead className={head}>{t("detail.line-columns.today")}</TableHead>
                                    {priced && <TableHead className={`${head} text-right`}>{t("detail.line-columns.amount")}</TableHead>}
                                    {(canEndLine || canAddLine) && <TableHead className={head} />}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rental.lines.map((line) => {
                                    const today = todayOf(line)

                                    return (
                                        <TableRow key={line.id}>
                                            <TableCell className={cell}>
                                                <div className="flex flex-col items-start gap-0.5">
                                                    <PlateChip plate={plateOf(line)} />
                                                    {line.driver && <span className="text-muted-foreground text-xs">{line.driver.name}</span>}
                                                    {line.endsOn && (
                                                        <span className="text-muted-foreground text-xs">
                                                            {t("values.ended", { date: f.dateTime(localDate(line.endsOn), { dateStyle: "medium" }) })}
                                                        </span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className={cell}>
                                                {line.provider ? line.provider.name ?? "—" : <span className="text-muted-foreground">{t("values.own-fleet")}</span>}
                                            </TableCell>
                                            <TableCell className={`${cell} text-right tabular-nums`}>
                                                {line.projectedDays === null
                                                    ? t("values.days-open", { billable: line.billing.billableDays })
                                                    : t("values.days-of", { billable: line.billing.billableDays, total: line.projectedDays })}
                                            </TableCell>
                                            <TableCell className={`${cell} ${line.today.answer === "no" || line.today.silent ? "text-amber-600 dark:text-amber-400" : ""}`}>
                                                {today ?? <Dash />}
                                            </TableCell>
                                            {priced && (
                                                <TableCell className={`${cell} text-right tabular-nums`}>
                                                    {line.billing.amount === null ? <Dash /> : money(line.billing.amount, rental.currency)}
                                                </TableCell>
                                            )}
                                            {(canEndLine || canAddLine) && (
                                                <TableCell className={`${cell} text-right`}>
                                                    <div className="flex items-center justify-end gap-1">
                                                        {canEndLine && line.endsOn === null && (
                                                            <Button size="sm" variant="outline" onClick={() => setEnding(line)}>
                                                                {t("detail.actions.end-line")}
                                                            </Button>
                                                        )}
                                                        {canAddLine && untouched(line) && (
                                                            <Button
                                                                size="icon-sm"
                                                                variant="ghost"
                                                                aria-label={t("detail.actions.remove-line")}
                                                                disabled={removeLine.isPending}
                                                                onClick={() => setRemoving(line)}
                                                            >
                                                                <IconTrash className="size-4" stroke={1.5} />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </SectionCard>

            {adding && <AddLineDialog rental={rental} onClose={() => setAdding(false)} />}
            {ending && <EndLineDialog rental={rental} line={ending} onClose={() => setEnding(null)} />}

            <AlertDialog open={removing !== null} onOpenChange={(next) => { if (!next) setRemoving(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("detail.actions.remove-line")}</AlertDialogTitle>
                        <AlertDialogDescription>{t("detail.actions.remove-line-confirm", { plate: removing ? plateOf(removing) : "" })}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("form.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { if (removing) removeLine.mutate({ id: removing.id }) }}>
                            {t("detail.actions.remove-line")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

type LineForm = {
    /** OWN, a connected transporter's organization id, or TYPED */
    who: string
    carrierName: string
    truckId: string
    driverId: string
    truckPlate: string
    buyRate: string
}

const positive = (value: string) => Number.isFinite(Number(value)) && Number(value) > 0

/**
 * Another truck on the rental: the owner's own (picked from its fleet), or
 * a transporter's — connected or typed — with its plate and what the owner
 * pays it per day. Every line needs a plate: a partner's rig is not in the
 * owner's fleet, so it is typed.
 */
export function AddLineDialog({ rental, onClose }: { rental: RentalDetail; onClose: () => void }) {
    const t = useTranslations("App.rentals")
    const trpc = useTRPC()

    const { addLine } = useRentalMutations()
    const [error, setError] = useState<RentalErrorCode | null>(null)

    const { data: options } = useQuery(trpc.movements.formOptions.queryOptions())
    const carriers = (options?.partners ?? []).filter((row) => row.type !== "shipper")

    const FormSchema = useMemo(() => z
        .object({
            who: z.string(),
            carrierName: z.string().trim().max(120),
            truckId: z.string(),
            driverId: z.string(),
            truckPlate: z.string().trim().max(60),
            buyRate: z.string(),
        })
        .refine((data) => data.who !== TYPED || data.carrierName.length > 0, { message: t("form.errors.name"), path: ["carrierName"] })
        .refine((data) => data.who !== OWN || data.truckId !== NONE, { message: t("form.errors.truck"), path: ["truckId"] })
        .refine((data) => data.who === OWN || data.truckPlate.length > 0, { message: t("form.errors.truck"), path: ["truckPlate"] })
        .refine((data) => data.who === OWN || positive(data.buyRate), { message: t("form.errors.rate"), path: ["buyRate"] }), [t])

    const form = useForm<LineForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: { who: OWN, carrierName: "", truckId: NONE, driverId: NONE, truckPlate: "", buyRate: "" },
    })

    const who = useWatch({ control: form.control, name: "who" })
    const own = who === OWN
    const typed = who === TYPED
    const isPending = addLine.isPending

    function onSubmit(values: LineForm) {
        setError(null)

        addLine.mutate(
            {
                contractId: rental.id,
                carrierOrgId: own || typed ? null : values.who,
                carrierName: typed ? values.carrierName.trim() : null,
                truckId: own ? values.truckId : null,
                driverId: own && values.driverId !== NONE ? values.driverId : null,
                truckPlate: own ? null : values.truckPlate.trim(),
                buyPrice: own ? null : { model: "per-day", rate: Number(values.buyRate), billableDays: rental.sellPrice?.billableDays ?? "calendar" },
            },
            { onSuccess: onClose, onError: (failure) => setError(rentalErrorKey(failure)) },
        )
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("detail.actions.add-line")}</DialogTitle>
                    <DialogDescription>{rental.ref}</DialogDescription>
                </DialogHeader>

                <form id="rental-line-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        <SelectInput control={form.control} name="who" isPending={isPending} label={t("form.lines.provider")}>
                            <SelectItem value={OWN}>{t("form.lines.own-fleet")}</SelectItem>
                            {carriers.map((row) => (
                                <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                            ))}
                            <SelectItem value={TYPED}>{t("form.lines.typed")}</SelectItem>
                        </SelectInput>

                        {typed && <TextInput control={form.control} name="carrierName" isPending={isPending} label={t("form.lines.carrier-name")} />}

                        {own ? (
                            <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                                <SelectInput control={form.control} name="truckId" isPending={isPending} label={t("form.lines.truck")}>
                                    <SelectItem value={NONE}>{t("form.lines.truck-none")}</SelectItem>
                                    {(options?.trucks ?? []).map((row) => (
                                        <SelectItem key={row.id} value={row.id}>{row.plate}</SelectItem>
                                    ))}
                                </SelectInput>
                                <SelectInput control={form.control} name="driverId" isPending={isPending} label={t("form.lines.driver")}>
                                    <SelectItem value={NONE}>{t("form.lines.driver-none")}</SelectItem>
                                    {(options?.drivers ?? []).map((row) => (
                                        <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
                                    ))}
                                </SelectInput>
                            </FieldGroup>
                        ) : (
                            <>
                                <TextInput control={form.control} name="truckPlate" isPending={isPending} label={t("form.lines.truck-plate")} />
                                <DecimalInput
                                    control={form.control}
                                    name="buyRate"
                                    isPending={isPending}
                                    label={`${t("form.lines.buy-rate")} (${rental.currency})`}
                                />
                            </>
                        )}

                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                            </Alert>
                        )}
                    </FieldGroup>
                </form>

                <DialogFooter>
                    <Button variant="outline" disabled={isPending} onClick={onClose}>{t("form.cancel")}</Button>
                    <Button type="submit" form="rental-line-form" disabled={isPending}>
                        {isPending && <Spinner className="size-4" />}
                        {isPending ? t("form.saving") : t("form.lines.add")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** The truck leaves early: its days stop counting after the picked day. */
function EndLineDialog({ rental, line, onClose }: { rental: RentalDetail; line: RentalLineView; onClose: () => void }) {
    const t = useTranslations("App.rentals")
    const f = useFormatter()

    const { endLine } = useRentalMutations()
    const form = useForm<{ endsOn: Date }>({ defaultValues: { endsOn: new Date() } })
    const endsOn = useWatch({ control: form.control, name: "endsOn" })
    const isPending = endLine.isPending

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("detail.actions.end-line")}</DialogTitle>
                    <DialogDescription>
                        {t("detail.actions.end-line-confirm", { plate: plateOf(line), date: f.dateTime(endsOn, { dateStyle: "medium" }) })}
                    </DialogDescription>
                </DialogHeader>

                <form
                    id="rental-end-line-form"
                    onSubmit={form.handleSubmit((values) => endLine.mutate({ id: line.id, endsOn: isoOf(values.endsOn) }, { onSuccess: onClose }))}
                >
                    <FieldGroup className="gap-4">
                        <DateInput control={form.control} name="endsOn" isPending={isPending} value={localDate(rental.startsOn)} label={t("form.fields.ends-on")} />
                    </FieldGroup>
                </form>

                <DialogFooter>
                    <Button variant="outline" disabled={isPending} onClick={onClose}>{t("form.cancel")}</Button>
                    <Button type="submit" form="rental-end-line-form" disabled={isPending}>
                        {isPending && <Spinner className="size-4" />}
                        {t("detail.actions.end-line")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
