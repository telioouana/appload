"use client"

import { useTranslations } from "@workspace/i18n"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import { countForKind, kindsFor, type OrgType, type PartnerListKind, type PartnerStats } from "@/frontend/pages/partners/types"

/**
 * The organization's lists, under the title rather than inside the list card:
 * the requests list is not a filter of the same rows, it is a different thing
 * to do. The lists are routes, so this is a set of links — each one is
 * addressable, and following one starts the list clean instead of carrying
 * the page, the open profile or a direction into it.
 */
export function PartnersTabs({ orgType, kind, stats }: { orgType: OrgType; kind: PartnerListKind; stats: PartnerStats }) {
    const t = useTranslations("App.partners.tabs")

    return (
        <div className="bg-muted mt-2 flex w-fit gap-0.5 rounded-full p-1">
            {kindsFor(orgType).map((value) => {
                const active = value === kind

                return (
                    <Link
                        key={value}
                        href={{ pathname: "/partners/[kind]", params: { kind: value } }}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                            "text-muted-foreground flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
                            active && "bg-background text-foreground font-medium shadow-sm",
                        )}
                    >
                        {t(value)}
                        <span className={cn(
                            "text-muted-foreground rounded-full text-[11px] tabular-nums",
                            active && "text-primary",
                        )}>
                            {countForKind(orgType, value, stats).toLocaleString()}
                        </span>
                    </Link>
                )
            })}
        </div>
    )
}
