"use client"

import { useTranslations } from "@workspace/i18n"

import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { CURRENCY_CODES, useMetricsCurrency } from "@/frontend/pages/metrics/hooks/use-metrics-currency"
import { PRESENTATION_CURRENCIES } from "@/frontend/pages/metrics/types"

/**
 * Dollars or meticais, for every figure on the page at once. The choice rides
 * in the URL like the year does, so a link keeps the currency it was read in
 * — but it is written without routing: the server never reads it (the query
 * carries both presentations), so a round trip would only redraw the same
 * page. Dollars are the default and leave the URL clean.
 */
export function CurrencyToggle() {
    const t = useTranslations("Admin.metrics")
    const { currency } = useMetricsCurrency()
    const { shallow } = useListParams()

    return (
        <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            aria-label={t("currency")}
            value={currency}
            onValueChange={(value) => {
                // Radix hands back "" when the pressed item is pressed again;
                // the page always shows one currency, so that is ignored
                if (!(PRESENTATION_CURRENCIES as readonly string[]).includes(value)) return

                shallow({ key: "currency", value: value === "usd" ? null : value })
            }}
        >
            {PRESENTATION_CURRENCIES.map((key) => (
                <ToggleGroupItem key={key} value={key} className="text-xs">
                    {CURRENCY_CODES[key]}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    )
}
