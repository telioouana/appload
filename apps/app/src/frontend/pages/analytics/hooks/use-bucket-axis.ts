"use client"

import { useFormatter } from "@workspace/i18n"

import { bucketGrain } from "@workspace/domain/kpis/types"

/**
 * How a bucket names itself on an axis and in a tooltip. The period is cut
 * into calendar months, or into ISO weeks when it is short enough that
 * months would be one column, and the two charts on the page have to label
 * the same columns the same way — so the arithmetic lives here rather than
 * in each of them.
 *
 * `yyyy-mm-dd` sorts as it reads, so clipping a week to the period is a
 * string comparison, and every label is built at UTC noon or mid-month:
 * Maputo is UTC+2, and a local `Date` would slide a label to the day or the
 * month before the bucket it names.
 */
export function useBucketAxis(from: string, to: string) {
    const f = useFormatter()

    const grain = bucketGrain(from, to)

    const later = (day: string, other: string) => (day > other ? day : other)
    const earlier = (day: string, other: string) => (day < other ? day : other)

    const partsOf = (day: string): [number, number, number] => [
        Number(day.slice(0, 4)),
        Number(day.slice(5, 7)),
        Number(day.slice(8, 10)),
    ]

    const dayAfter = (day: string, count: number) => {
        const [year, month, date] = partsOf(day)
        return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10)
    }

    const midMonth = (day: string) => {
        const [year, month] = partsOf(day)
        return new Date(Date.UTC(year, month - 1, 15))
    }

    const midDay = (day: string) => {
        const [year, month, date] = partsOf(day)
        return new Date(Date.UTC(year, month - 1, date, 12))
    }

    // A period inside one year names its months bare; one that crosses New
    // Year has to say which January it means
    const spansYears = from.slice(0, 4) !== to.slice(0, 4)

    const axisLabel = (start: string) => {
        if (grain === "month") {
            const short = f.dateTime(midMonth(start), { month: "short" })
            return spansYears ? `${short} ${start.slice(0, 4)}` : short
        }

        // A week bucket starts on its ISO Monday, which for the first one is
        // before the period began; the count is scoped, only the label moves
        return f.dateTime(midDay(later(start, from)), { day: "numeric", month: "short" })
    }

    const title = (start: string) => {
        if (grain === "month") return f.dateTime(midMonth(start), { month: "long", year: "numeric" })

        const first = midDay(later(start, from))
        const last = midDay(earlier(dayAfter(start, 6), to))

        return `${f.dateTime(first, { day: "numeric", month: "short" })} – ${f.dateTime(last, { day: "numeric", month: "short" })}`
    }

    return { axisLabel, title }
}
