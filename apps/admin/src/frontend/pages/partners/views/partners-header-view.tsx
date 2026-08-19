"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { IconPlus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"

import { PageHeader } from "@/components/list/page-header"
import { RegisterPartnerDialog, type RegisterTarget } from "@/frontend/pages/partners/sections/register-partner"
import { currentKind, VEHICLE_KINDS } from "@/frontend/pages/partners/types"

type Page = "shippers" | "carriers" | "drivers" | "fleet"

const SEARCH_SCOPE: Record<Page, "organization" | "driver" | "fleet"> = {
    shippers: "organization",
    carriers: "organization",
    drivers: "driver",
    fleet: "fleet",
}

export function PartnersHeaderView({ page }: { page: Page }) {
    const t = useTranslations("Admin.partners")
    const searchParams = useSearchParams()

    const [registerOpen, setRegisterOpen] = useState(false)

    // Trucks, trailers and links share one page — the kind is a filter, not
    // a route, so switching does not remount the page or lose the search
    const kind = currentKind((key) => searchParams.get(key))

    const target: RegisterTarget =
        page === "shippers" ? { kind: "organization", type: "shipper" }
            : page === "carriers" ? { kind: "organization", type: "carrier" }
                : page === "drivers" ? { kind: "driver" }
                    : { kind: "vehicle", vehicle: kind }

    return (
        <>
            <PageHeader
                title={t(`${page}.title`)}
                description={t(`${page}.description`)}
                search={{
                    placeholder: t(`filters.search.${SEARCH_SCOPE[page]}`),
                    clearLabel: t("filters.clear"),
                }}
                segmented={page === "fleet" ? {
                    param: "kind",
                    active: kind,
                    options: VEHICLE_KINDS.map((value) => ({
                        value,
                        label: t(`fleet.kind.${value}`),
                    })),
                } : undefined}
                action={
                    <Button onClick={() => setRegisterOpen(true)}>
                        <IconPlus className="size-4" stroke={1.5} />
                        {t(`${page}.add`)}
                    </Button>
                }
            />

            <RegisterPartnerDialog
                target={target}
                open={registerOpen}
                onOpenChange={setRegisterOpen}
            />
        </>
    )
}
