"use client"

import { useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { useSuspenseQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { IconDownload } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { useTRPC } from "@/backend/api/client"
import { fillKpiTemplate, kpiFileName, type KpiLang } from "@/lib/kpis/pdf"
import { reportInput } from "@/frontend/pages/kpis/types"

const LANGUAGES: KpiLang[] = ["en", "pt"]

/**
 * The report on Claire's own KPI form, filled from the figures on screen.
 * The language is the reader's choice and not the app's: a report for a
 * Portuguese client prints in Portuguese from an English session, so the two
 * items are languages rather than a single "download".
 *
 * Everything happens in the browser — the template is fetched from `public/`,
 * filled and handed straight to the download — so nothing is generated
 * server-side and there is no file to clean up but the object URL.
 */
export function DownloadMenu() {
    const t = useTranslations("Admin.kpis")
    const trpc = useTRPC()
    const searchParams = useSearchParams()
    const { party } = useParams<{ party: string }>()

    const [busy, setBusy] = useState(false)

    const { data: report } = useSuspenseQuery(
        trpc.kpis.report.queryOptions(reportInput(party, (key) => searchParams.get(key))),
    )

    const download = async (lang: KpiLang) => {
        if (busy) return
        setBusy(true)

        try {
            const blob = await fillKpiTemplate(report, lang)
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement("a")
            anchor.href = url
            anchor.download = kpiFileName(report, lang)
            anchor.click()
            // Not revoked before the download has started, as the CSV export does
            window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch (error) {
            console.error(error)
            toast.error(t("download.failed"))
        } finally {
            setBusy(false)
        }
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={busy}>
                    <IconDownload className="size-4" stroke={1.5} />
                    {t("download.label")}
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
                {LANGUAGES.map((lang) => (
                    <DropdownMenuItem key={lang} onSelect={() => void download(lang)}>
                        {t(`download.${lang}`)}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
