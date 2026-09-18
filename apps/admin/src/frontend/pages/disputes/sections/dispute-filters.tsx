"use client"

import { useTranslations } from "@workspace/i18n"
import { DISPUTE_LIABLE_PARTY, DISPUTE_REASON } from "@workspace/db/types"

import { FilterChoice } from "@workspace/ui/customs/list/filter-controls"
import { HOLD_SIDES } from "@/frontend/pages/disputes/types"

/** The Filters popover: the cause, who is thought liable, and whose money is held. */
export function DisputeFilters() {
    const t = useTranslations("Admin.disputes")

    return (
        <div className="flex flex-col gap-4">
            <FilterChoice
                label={t("filters.reason")}
                param="reason"
                anyLabel={t("filters.any")}
                options={DISPUTE_REASON.map((value) => ({ value, label: t(`values.reasons.${value}`) }))}
            />
            <FilterChoice
                label={t("filters.liable")}
                param="liable"
                anyLabel={t("filters.any")}
                options={DISPUTE_LIABLE_PARTY.map((value) => ({ value, label: t(`values.liable.${value}`) }))}
            />
            <FilterChoice
                label={t("filters.hold")}
                param="hold"
                anyLabel={t("filters.any")}
                options={HOLD_SIDES.map((value) => ({ value, label: t(`values.hold-${value}`) }))}
            />
        </div>
    )
}
