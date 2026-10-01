"use client"

import { useState } from "react"
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { PlateChip } from "@workspace/ui/customs/list/table-cells"
import { cn } from "@workspace/ui/lib/utils"

import { RENTAL_DAY_STATE } from "@/backend/schemas/rental"
import { useRentalMutations } from "@/frontend/pages/rentals/hooks/use-rental-mutations"
import { localDate, todayIso } from "@/frontend/pages/rentals/lib/dates"
import { rentalErrorKey, type RentalErrorCode } from "@/frontend/pages/rentals/lib/errors"
import { plateOf } from "@/frontend/pages/rentals/sections/lines-card"
import type { RentalDayState, RentalDayView, RentalDetail, RentalLineView } from "@/frontend/pages/rentals/types"

/** A cell's tint by how the day counted. */
const TINT: Record<RentalDayState, string> = {
    worked: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
    standby: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    stopped: "bg-rose-500/15 text-rose-800 dark:text-rose-300",
    off: "bg-muted text-muted-foreground line-through",
}

const monthOf = (iso: string) => iso.slice(0, 7)
const shiftMonth = (month: string, by: number) => {
    const [year, m] = month.split("-").map(Number)
    const date = new Date(year ?? 1970, (m ?? 1) - 1 + by, 1, 12)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

/**
 * The diary: one calendar per truck, a month at a time, every day coloured
 * by how it counted. Unmarked is worked and billed. The provider clicks a
 * day to say otherwise; the client clicks one to dispute it. Days that
 * have not come, or fall outside the line's period (Sundays under working
 * days among them), are not on the line's log and cannot be clicked.
 */
export function DiaryCard({ rental }: { rental: RentalDetail }) {
    const t = useTranslations("App.rentals.detail")
    const f = useFormatter()

    const today = todayIso()
    const first = monthOf(rental.startsOn)
    const last = monthOf(rental.endsOn && rental.endsOn < today ? rental.endsOn : today)
    const clamp = (month: string) => (month < first ? first : month > last ? last : month)

    // One month for every truck: the trucks are read side by side
    const [month, setMonth] = useState(() => clamp(monthOf(today)))
    const [picked, setPicked] = useState<{ line: RentalLineView; day: RentalDayView } | null>(null)

    const { canMark, canDispute } = rental.permissions
    const help = canMark ? "provider" : canDispute ? "client" : "reader"

    // 2024-01-01 is a Monday
    const weekdays = Array.from({ length: 7 }, (_, i) => f.dateTime(new Date(2024, 0, 1 + i, 12), { weekday: "short" }))
    const firstDay = localDate(`${month}-01`)
    const leading = (firstDay.getDay() + 6) % 7
    const count = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate()
    const days = Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)

    const end = rental.endsOn
    const inPeriod = (line: RentalLineView, day: string) => day >= rental.startsOn && (end === null || day <= end) && (line.endsOn === null || day <= line.endsOn)

    return (
        <>
            <SectionCard
                title={t("diary")}
                actions={rental.lines.length > 0 ? (
                    <div className="flex items-center gap-1">
                        <Button size="icon-sm" variant="ghost" aria-label={t("diary-nav.prev")} disabled={month <= first} onClick={() => setMonth(shiftMonth(month, -1))}>
                            <IconChevronLeft className="size-4" stroke={1.5} />
                        </Button>
                        <span className="min-w-32 text-center text-[13px] font-medium capitalize tabular-nums">
                            {f.dateTime(firstDay, { month: "long", year: "numeric" })}
                        </span>
                        <Button size="icon-sm" variant="ghost" aria-label={t("diary-nav.next")} disabled={month >= last} onClick={() => setMonth(shiftMonth(month, 1))}>
                            <IconChevronRight className="size-4" stroke={1.5} />
                        </Button>
                    </div>
                ) : undefined}
            >
                {rental.lines.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{t("no-lines")}</p>
                ) : (
                    <div className="flex flex-col gap-5">
                        {rental.lines.map((line) => {
                            const byDay = new Map(line.days.map((day) => [day.day, day]))

                            return (
                                <div key={line.id} className="flex flex-col gap-2">
                                    <div className="flex items-center gap-2">
                                        <PlateChip plate={plateOf(line)} />
                                        {line.driver && <span className="text-muted-foreground text-xs">{line.driver.name}</span>}
                                    </div>

                                    <div className="grid grid-cols-7 gap-1 text-center text-xs">
                                        {weekdays.map((name) => (
                                            <span key={name} className="text-muted-foreground py-1 text-[11px] capitalize">{name}</span>
                                        ))}
                                        {Array.from({ length: leading }, (_, i) => <span key={`pad-${i}`} />)}
                                        {days.map((iso) => {
                                            const day = byDay.get(iso)
                                            const silent = iso === today && line.today.silent

                                            if (!day) {
                                                return (
                                                    <span
                                                        key={iso}
                                                        className={cn(
                                                            "flex h-8 items-center justify-center rounded-md tabular-nums",
                                                            inPeriod(line, iso) ? "text-muted-foreground" : "text-muted-foreground/40",
                                                            silent && "border border-dashed border-amber-500",
                                                        )}
                                                    >
                                                        {Number(iso.slice(8))}
                                                    </span>
                                                )
                                            }

                                            return (
                                                <button
                                                    key={iso}
                                                    type="button"
                                                    onClick={() => setPicked({ line, day })}
                                                    className={cn(
                                                        "flex h-8 items-center justify-center rounded-md font-medium tabular-nums transition-colors hover:ring-2 hover:ring-ring/40",
                                                        TINT[day.state],
                                                        day.disputed && "ring-2 ring-red-500",
                                                        silent && "border border-dashed border-amber-500",
                                                    )}
                                                >
                                                    {Number(iso.slice(8))}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        })}

                        <div className="text-muted-foreground flex flex-col gap-1.5 border-t pt-3 text-xs">
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                                {RENTAL_DAY_STATE.map((state) => (
                                    <span key={state} className="flex items-center gap-1.5">
                                        <span className={cn("size-3 rounded-sm", TINT[state])} />
                                        {t(`legend.${state}`)}
                                    </span>
                                ))}
                                <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm ring-2 ring-red-500" />{t("legend.disputed")}</span>
                                <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm border border-dashed border-amber-500" />{t("legend.silent")}</span>
                                <span className="flex items-center gap-1.5"><span className="bg-muted/60 size-3 rounded-sm" />{t("legend.future")}</span>
                            </div>
                            <p>{t(`diary-help.${help}`)}</p>
                        </div>
                    </div>
                )}
            </SectionCard>

            {picked && <DayDialog rental={rental} line={picked.line} day={picked.day} onClose={() => setPicked(null)} />}
        </>
    )
}

/**
 * One day of one truck: how it counted and what was said about it. The
 * provider re-marks it or accepts the client's dispute (the day stops
 * counting); the client disputes it or takes the dispute back.
 */
function DayDialog({ rental, line, day, onClose }: { rental: RentalDetail; line: RentalLineView; day: RentalDayView; onClose: () => void }) {
    const t = useTranslations("App.rentals")
    const f = useFormatter()

    const { markDay, disputeDay, settleDispute } = useRentalMutations()
    const [state, setState] = useState<RentalDayState>(day.state)
    const [note, setNote] = useState("")
    const [why, setWhy] = useState("")
    const [error, setError] = useState<RentalErrorCode | null>(null)

    const { canMark, canDispute } = rental.permissions
    const isPending = markDay.isPending || disputeDay.isPending || settleDispute.isPending
    const target = { allocationId: line.id, day: day.day }
    const handlers = { onSuccess: onClose, onError: (failure: unknown) => setError(rentalErrorKey(failure)) }

    return (
        <Dialog open onOpenChange={(next) => { if (!next && !isPending) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="capitalize">{f.dateTime(localDate(day.day), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</DialogTitle>
                    <DialogDescription>{plateOf(line)} · {t(`day-states.${day.state}`)}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {day.answer && <p className="text-[13px]">{t(day.answer === "yes" ? "detail.day.answer-yes" : "detail.day.answer-no")}</p>}
                    {day.disputed && (
                        <p className="text-[13px] font-medium text-red-600 dark:text-red-400">{t("detail.day.disputed-by-client", { note: "none" })}</p>
                    )}

                    {canMark && (
                        <div className="flex flex-col gap-3">
                            <Label>{t("detail.day.state")}</Label>
                            <RadioGroup value={state} onValueChange={(value) => setState(value as RentalDayState)} disabled={isPending}>
                                {RENTAL_DAY_STATE.map((option) => (
                                    <div key={option} className="flex items-center gap-2">
                                        <RadioGroupItem value={option} id={`day-state-${option}`} />
                                        <Label htmlFor={`day-state-${option}`} className="font-normal">{t(`day-states.${option}`)}</Label>
                                    </div>
                                ))}
                            </RadioGroup>
                            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("detail.day.note")} maxLength={300} disabled={isPending} />
                        </div>
                    )}

                    {canDispute && !day.disputed && (
                        <Input value={why} onChange={(event) => setWhy(event.target.value)} placeholder={t("detail.day.dispute-note")} maxLength={300} disabled={isPending} />
                    )}

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter className="flex-wrap">
                    <Button variant="outline" disabled={isPending} onClick={onClose}>{t("detail.day.cancel")}</Button>

                    {canMark && day.disputed && (
                        <Button variant="outline" disabled={isPending} onClick={() => settleDispute.mutate({ ...target, resolution: "accept" }, handlers)}>
                            {t("detail.day.accept")}
                        </Button>
                    )}
                    {canMark && (
                        <Button disabled={isPending} onClick={() => markDay.mutate({ ...target, state, note: note.trim() || null }, handlers)}>
                            {t("detail.day.save")}
                        </Button>
                    )}

                    {canDispute && (day.disputed ? (
                        <Button variant="outline" disabled={isPending} onClick={() => settleDispute.mutate({ ...target, resolution: "withdraw" }, handlers)}>
                            {t("detail.day.withdraw")}
                        </Button>
                    ) : (
                        <Button variant="destructive" disabled={isPending} onClick={() => disputeDay.mutate({ ...target, note: why.trim() || null }, handlers)}>
                            {t("detail.day.dispute")}
                        </Button>
                    ))}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
