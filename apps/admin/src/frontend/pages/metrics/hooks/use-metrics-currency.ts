"use client"

import { useSearchParams } from "next/navigation"

import { metricsCurrency, type PresentationCurrency } from "@/frontend/pages/metrics/types"

/** The ISO code a presentation currency is named by in headings. */
export const CURRENCY_CODES: Record<PresentationCurrency, string> = { usd: "USD", mzn: "MZN" }

/**
 * The currency every money figure on the page is shown in, read off
 * `?currency=` the same way the view and the toggle read it — so a card, the
 * heading above it and the control in the header can never disagree. The
 * query already carries both presentations, so switching is a re-render, not
 * a refetch.
 */
export function useMetricsCurrency() {
    const searchParams = useSearchParams()
    const currency = metricsCurrency((key) => searchParams.get(key))

    return { currency, code: CURRENCY_CODES[currency] }
}
