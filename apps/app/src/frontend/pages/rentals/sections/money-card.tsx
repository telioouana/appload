"use client"

import { useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { IconPlus } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { FieldGroup } from "@workspace/ui/components/field"
import { SelectItem } from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { DetailRow, SectionCard } from "@workspace/ui/customs/detail/section-card"
import { Dash } from "@workspace/ui/customs/list/table-cells"
import { DateInput } from "@workspace/ui/inputs/date"
import { DecimalInput } from "@workspace/ui/inputs/decimal"
import { SelectInput } from "@workspace/ui/inputs/select"
import { TextInput } from "@workspace/ui/inputs/text"

import { NONE } from "@/backend/schemas/movement"
import { useRentalMutations } from "@/frontend/pages/rentals/hooks/use-rental-mutations"
import { localDate } from "@/frontend/pages/rentals/lib/dates"
import { rentalErrorKey, type RentalErrorCode } from "@/frontend/pages/rentals/lib/errors"
import { plateOf } from "@/frontend/pages/rentals/sections/lines-card"
import type { MonthRow, RentalDetail } from "@/frontend/pages/rentals/types"
import { useMoney } from "@/frontend/pages/movements/components/badges"

// Payments are booked after the fact; the calendar opens two years back
const SINCE = new Date(new Date().getFullYear() - 2, 0, 1)

/**
 * The rental's money, rolled up from the days: what is billable so far and
 * to the end of the period, what moved and what is still owed — from where
 * the reader stands. The owner reads both sides and each provider's line;
 * the client what it pays; a provider what it is owed on its trucks. Then
 * the statement by month and the payments recorded.
 */
export function MoneyCard({ rental }: { rental: RentalDetail }) {
    const t = useTranslations("App.rentals.detail")
    const f = useFormatter()
    const money = useMoney()

    const [paying, setPaying] = useState(false)

    const { role, currency } = rental
    const owner = role === "owner"
    // An owner with no priced client has no receivable half: its money is what it pays the providers
    const sells = !owner || rental.sellPrice !== null
    const lineOf = (allocationId: string) => rental.lines.find((line) => line.id === allocationId)

    // Every truck's statement folded into one row per month
    const months = new Map<string, MonthRow>()
    for (const row of rental.lines.flatMap((line) => line.statement)) {
        const sum = months.get(row.month) ?? { month: row.month, worked: 0, standby: 0, amount: 0 }
        months.set(row.month, { month: row.month, worked: sum.worked + row.worked, standby: sum.standby + row.standby, amount: Math.round((sum.amount + row.amount) * 100) / 100 })
    }
    const statement = [...months.values()].sort((a, b) => a.month.localeCompare(b.month))

    const head = "h-8 px-2 text-xs font-normal"
    const cell = "px-2 py-2 text-[13px] tabular-nums"
    const table = "container-snap -mx-5 overflow-x-auto px-5 [&_[data-slot=table-container]]:overflow-visible"

    return (
        <>
            <SectionCard
                title={t("money")}
                actions={rental.permissions.canRecordPayment ? (
                    <Button size="sm" variant="outline" onClick={() => setPaying(true)}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t("actions.record-payment")}
                    </Button>
                ) : undefined}
            >
                <div className="flex flex-col gap-4">
                    {rental.money.lines.map((line) => (
                        <dl key={line.currency} className="flex flex-col gap-2">
                            {sells && (
                                <>
                                    <DetailRow label={t("money-rows.billable")}>{money(line.billable, line.currency)}</DetailRow>
                                    {/* A provider has no order price to project; its billable is what it is owed */}
                                    {role !== "carrier" && (
                                        <DetailRow label={t("money-rows.projected")}>
                                            {line.projected === null ? <span className="text-muted-foreground">{t("money-rows.open")}</span> : money(line.projected, line.currency)}
                                        </DetailRow>
                                    )}
                                    <DetailRow label={t("money-rows.received")}>{money(line.received, line.currency)}</DetailRow>
                                    <DetailRow label={t("money-rows.receivable")}>
                                        <span className={line.receivable > 0 ? "font-medium" : undefined}>{money(line.receivable, line.currency)}</span>
                                    </DetailRow>
                                </>
                            )}
                            {owner && (line.payable > 0 || rental.money.perLine.length > 0) && (
                                <>
                                    <DetailRow label={t("money-rows.payable")}>{money(line.payable, line.currency)}</DetailRow>
                                    <DetailRow label={t("money-rows.paid")}>{money(line.paid, line.currency)}</DetailRow>
                                    <DetailRow label={t("money-rows.outstanding")}>
                                        <span className={line.outstanding > 0 ? "font-medium" : undefined}>{money(line.outstanding, line.currency)}</span>
                                    </DetailRow>
                                </>
                            )}
                        </dl>
                    ))}

                    {owner && rental.money.perLine.length > 0 && (
                        <div className="flex flex-col gap-2 border-t pt-3.5">
                            <span className="text-muted-foreground text-xs font-medium">{t("money-rows.per-line")}</span>
                            <div className={table}>
                                <Table>
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className={head}>{t("line-columns.truck")}</TableHead>
                                            <TableHead className={`${head} text-right`}>{t("money-rows.billable")}</TableHead>
                                            <TableHead className={`${head} text-right`}>{t("money-rows.paid")}</TableHead>
                                            <TableHead className={`${head} text-right`}>{t("money-rows.outstanding")}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rental.money.perLine.map((row) => {
                                            const line = lineOf(row.allocationId)

                                            return (
                                                <TableRow key={row.allocationId}>
                                                    <TableCell className={cell}>{line ? `${plateOf(line)} · ${line.provider?.name ?? "—"}` : <Dash />}</TableCell>
                                                    <TableCell className={`${cell} text-right`}>{money(row.billable, row.currency)}</TableCell>
                                                    <TableCell className={`${cell} text-right`}>{money(row.paid, row.currency)}</TableCell>
                                                    <TableCell className={`${cell} text-right ${row.outstanding > 0 ? "font-medium" : ""}`}>{money(row.outstanding, row.currency)}</TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    )}

                    {statement.length > 0 && (
                        <div className="flex flex-col gap-2 border-t pt-3.5">
                            <span className="text-muted-foreground text-xs font-medium">{t("money-rows.per-month")}</span>
                            <div className={table}>
                                <Table>
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className={head}>{t("money-rows.month")}</TableHead>
                                            <TableHead className={`${head} text-right`}>{t("money-rows.days")}</TableHead>
                                            <TableHead className={`${head} text-right`}>{t("money-rows.amount")}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {statement.map((row) => (
                                            <TableRow key={row.month}>
                                                <TableCell className={`${cell} capitalize`}>{f.dateTime(localDate(`${row.month}-01`), { month: "long", year: "numeric" })}</TableCell>
                                                <TableCell className={`${cell} text-right`}>{row.worked + row.standby}</TableCell>
                                                <TableCell className={`${cell} text-right`}>{money(row.amount, currency)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col gap-2 border-t pt-3.5">
                        <span className="text-muted-foreground text-xs font-medium">{t("payments")}</span>
                        {rental.payments.length === 0 ? (
                            <p className="text-muted-foreground text-sm">{t("no-payments")}</p>
                        ) : (
                            <div className={table}>
                                <Table>
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className={head}>{t("payment-form.paid-at")}</TableHead>
                                            <TableHead className={head}>{t("payment-form.leg")}</TableHead>
                                            <TableHead className={head}>{t("payment-form.line")}</TableHead>
                                            <TableHead className={`${head} text-right`}>{t("payment-form.amount")}</TableHead>
                                            <TableHead className={head}>{t("payment-form.reference")}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rental.payments.map((payment) => {
                                            const line = payment.allocationId ? lineOf(payment.allocationId) : undefined

                                            return (
                                                <TableRow key={payment.id}>
                                                    <TableCell className={cell}>{f.dateTime(payment.paidAt, { dateStyle: "medium" })}</TableCell>
                                                    <TableCell className={cell}>{t(`payment-form.${payment.leg}`)}</TableCell>
                                                    <TableCell className={cell}>{line ? plateOf(line) : <Dash />}</TableCell>
                                                    <TableCell className={`${cell} text-right ${payment.amount < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{money(payment.amount, payment.currency)}</TableCell>
                                                    <TableCell className={`${cell} text-muted-foreground`}>{payment.reference ?? <Dash />}</TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </div>
                </div>
            </SectionCard>

            {paying && <PaymentDialog rental={rental} onClose={() => setPaying(false)} />}
        </>
    )
}

type PaymentForm = { leg: "sell" | "buy"; allocationId: string; amount: string; paidAt: Date; reference: string }

/**
 * Money that moved on the rental: in from the client, or out to a
 * provider — the latter said per truck. A negative amount takes an earlier
 * payment back and needs a reference saying why; the server holds it to that.
 */
function PaymentDialog({ rental, onClose }: { rental: RentalDetail; onClose: () => void }) {
    const t = useTranslations("App.rentals")

    const { recordPayment } = useRentalMutations()
    const [error, setError] = useState<RentalErrorCode | null>(null)

    const providerLines = rental.lines.filter((line) => line.buyPrice !== null)
    // Without a priced client the only money that moves is what goes to the providers
    const sells = rental.sellPrice !== null
    const defaultLeg = sells ? "sell" : "buy"

    const FormSchema = useMemo(() => z
        .object({
            leg: z.enum(["sell", "buy"]),
            allocationId: z.string(),
            amount: z.string().refine((value) => Number.isFinite(Number(value)) && Number(value) !== 0, { message: t("errors.AMOUNT_REQUIRED") }),
            paidAt: z.date(),
            reference: z.string().trim().max(60),
        })
        .refine((data) => data.leg !== "buy" || data.allocationId !== NONE, { message: t("errors.LINE_REQUIRED"), path: ["allocationId"] }), [t])

    const form = useForm<PaymentForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: { leg: defaultLeg, allocationId: defaultLeg === "buy" && providerLines.length === 1 ? providerLines[0]!.id : NONE, amount: "", paidAt: new Date(), reference: "" },
    })

    const leg = useWatch({ control: form.control, name: "leg" })
    const isPending = recordPayment.isPending

    function onSubmit(values: PaymentForm) {
        setError(null)

        recordPayment.mutate(
            {
                contractId: rental.id,
                allocationId: values.allocationId === NONE ? null : values.allocationId,
                leg: values.leg,
                amount: Number(values.amount),
                currency: rental.currency,
                paidAt: values.paidAt,
                reference: values.reference.trim() || null,
            },
            { onSuccess: onClose, onError: (failure) => setError(rentalErrorKey(failure)) },
        )
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("detail.payment-form.title")}</DialogTitle>
                    <DialogDescription>{t("detail.payment-form.description")}</DialogDescription>
                </DialogHeader>

                <form id="rental-payment-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        {sells && providerLines.length > 0 && (
                            <SelectInput control={form.control} name="leg" isPending={isPending} label={t("detail.payment-form.leg")}>
                                <SelectItem value="sell">{t("detail.payment-form.sell")}</SelectItem>
                                <SelectItem value="buy">{t("detail.payment-form.buy")}</SelectItem>
                            </SelectInput>
                        )}

                        <SelectInput control={form.control} name="allocationId" isPending={isPending} label={t("detail.payment-form.line")}>
                            {leg === "sell" && <SelectItem value={NONE}>{t("detail.payment-form.whole")}</SelectItem>}
                            {(leg === "buy" ? providerLines : rental.lines).map((line) => (
                                <SelectItem key={line.id} value={line.id}>{plateOf(line)}{line.provider?.name ? ` · ${line.provider.name}` : ""}</SelectItem>
                            ))}
                        </SelectInput>

                        <DecimalInput
                            control={form.control}
                            name="amount"
                            isPending={isPending}
                            label={`${t("detail.payment-form.amount")} (${rental.currency})`}
                            description={t("detail.payment-form.correction-hint")}
                        />

                        <DateInput control={form.control} name="paidAt" isPending={isPending} value={SINCE} label={t("detail.payment-form.paid-at")} />

                        <TextInput control={form.control} name="reference" isPending={isPending} label={t("detail.payment-form.reference")} />

                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                            </Alert>
                        )}
                    </FieldGroup>
                </form>

                <DialogFooter>
                    <Button variant="outline" disabled={isPending} onClick={onClose}>{t("detail.payment-form.cancel")}</Button>
                    <Button type="submit" form="rental-payment-form" disabled={isPending}>
                        {isPending && <Spinner className="size-4" />}
                        {t("detail.payment-form.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
