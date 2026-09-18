"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Progress } from "@workspace/ui/components/progress"

import type { TrackingAllowance } from "@workspace/domain/subscription"

/**
 * "YYYY-MM" as a date the formatter can name. The period is already the
 * Maputo month the movement is billed to, so it is anchored at UTC midnight
 * on the first: the formatter renders in Africa/Maputo (UTC+2), which keeps
 * the month right whatever zone the browser sits in — building the date from
 * local parts would name the previous month east of UTC+2.
 */
const monthOf = (period: string): Date => new Date(`${period}-01T00:00:00Z`)

/**
 * What the company has used of this month's tracked movements. The same line
 * on the subscription card and in the plan dialog: the number a partner is
 * refused on has to read the same wherever it is shown. Only meaningful
 * while a plan is active — with no plan there is no allowance to spend.
 */
export function PlanUsage({ allowance }: { allowance: TrackingAllowance }) {
    const t = useTranslations("App.plan")
    const f = useFormatter()

    if (allowance.quota === null) {
        return <span className="text-muted-foreground text-sm">{t("unlimited")}</span>
    }

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-sm">
                {t("usage", {
                    used: allowance.used,
                    quota: allowance.quota,
                    month: f.dateTime(monthOf(allowance.period), { month: "long", year: "numeric" }),
                })}
            </span>

            <Progress value={Math.min(100, (allowance.used / allowance.quota) * 100)} />
        </div>
    )
}
