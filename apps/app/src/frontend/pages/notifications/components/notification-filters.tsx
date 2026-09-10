"use client"

import { useTranslations } from "@workspace/i18n"

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@workspace/ui/components/select"

import { cn } from "@workspace/ui/lib/utils"

import { useListParams } from "@/components/list/use-list-params"
import { KIND_FAMILIES, KINDS_BY_FAMILY, kindMessageKey } from "@/frontend/pages/notifications/types"

// Radix Select cannot carry an empty value, so "every kind" travels as a
// sentinel — the same one the list toolbar's filters use
const ANY = "__any"

const READ_STATES = ["all", "unread"] as const

/**
 * What the page is narrowed to: read state on the left, the kind on the
 * right. Both write the URL, so a filtered inbox survives a refresh and can
 * be linked to, and both drop the page — a narrower list must not open on a
 * page that no longer exists.
 */
export function NotificationFilters() {
    const t = useTranslations("App.notifications")
    const { get, set } = useListParams()

    const unread = get("unread") === "1"
    const kind = get("kind")

    return (
        <div className="mt-2 flex flex-wrap items-center gap-2">
            <div role="radiogroup" className="bg-muted flex w-fit gap-0.5 rounded-full p-1">
                {READ_STATES.map((state) => {
                    const selected = (state === "unread") === unread

                    return (
                        <button
                            key={state}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => set([
                                { key: "unread", value: state === "unread" ? "1" : null },
                                { key: "page", value: null },
                            ])}
                            className={cn(
                                "text-muted-foreground flex h-7 cursor-pointer items-center rounded-full px-3 text-[13px] transition-colors",
                                selected && "bg-background text-foreground font-medium shadow-sm",
                            )}
                        >
                            {t(`filters.${state}`)}
                        </button>
                    )
                })}
            </div>

            <Select
                value={kind ?? ANY}
                onValueChange={(next) => set([
                    { key: "kind", value: next === ANY ? null : next },
                    { key: "page", value: null },
                ])}
            >
                <SelectTrigger size="sm" className="w-60">
                    <SelectValue />
                </SelectTrigger>

                <SelectContent position="popper" className="max-h-80">
                    <SelectItem value={ANY}>{t("filters.any-kind")}</SelectItem>

                    {KIND_FAMILIES.map((family) => (
                        <SelectGroup key={family}>
                            <SelectLabel>{t(`families.${family}`)}</SelectLabel>

                            {KINDS_BY_FAMILY[family].map((entry) => (
                                <SelectItem key={entry} value={entry}>
                                    {t(`kind-labels.${kindMessageKey(entry)}`)}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
