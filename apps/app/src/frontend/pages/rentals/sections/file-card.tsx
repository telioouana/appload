"use client"

import { useRef, useState } from "react"
import { IconFileText, IconTrash, IconUpload } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"

import { useEdgeStore } from "@workspace/edgestore/client"
import { contractFilePath } from "@workspace/edgestore/path"

import { useRentalMutations } from "@/frontend/pages/rentals/hooks/use-rental-mutations"
import type { RentalDetail } from "@/frontend/pages/rentals/types"

/** What the bucket accepts for a signed paper. */
const ACCEPTED_FILES = ["application/pdf", "image/jpeg", "image/png"]

/**
 * The signed agreement. Between the owner and the client only — a provider
 * never reads it. A rental is a contract row, so the upload lands in the
 * contract's own folder and the address is written through the same door.
 */
export function FileCard({ rental }: { rental: RentalDetail }) {
    const t = useTranslations("App.rentals.detail")

    const { edgestore } = useEdgeStore()
    const { setFile, fail } = useRentalMutations()

    const [uploading, setUploading] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)

    const canManage = rental.role === "owner" && rental.permissions.canEdit
    const isPending = uploading || setFile.isPending

    async function upload(file: File) {
        setUploading(true)

        try {
            const { url } = await edgestore.apploadFiles.upload({ file, input: { path: contractFilePath(rental.id) } })
            setFile.mutate({ id: rental.id, expectedVersion: rental.version, url, name: file.name })
        } catch (failure) {
            console.error(failure)
            fail(failure)
        } finally {
            setUploading(false)
        }
    }

    return (
        <SectionCard
            title={t("file")}
            actions={canManage ? (
                <div className="flex items-center gap-1">
                    <input
                        ref={fileRef}
                        type="file"
                        className="hidden"
                        accept={ACCEPTED_FILES.join(",")}
                        onChange={(event) => {
                            const picked = event.target.files?.[0]
                            // The same file again has to be pickable after a failure
                            event.target.value = ""
                            if (picked && ACCEPTED_FILES.includes(picked.type)) void upload(picked)
                        }}
                    />
                    <Button size="sm" variant="outline" disabled={isPending} onClick={() => fileRef.current?.click()}>
                        {isPending ? <Spinner className="size-4" /> : <IconUpload className="size-4" stroke={1.5} />}
                        {t(rental.fileUrl ? "actions.replace" : "actions.upload")}
                    </Button>
                    {rental.fileUrl && (
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("actions.remove-file")}
                            disabled={isPending}
                            onClick={() => setFile.mutate({ id: rental.id, expectedVersion: rental.version, url: null, name: null })}
                        >
                            <IconTrash className="size-4" stroke={1.5} />
                        </Button>
                    )}
                </div>
            ) : undefined}
        >
            {rental.fileUrl ? (
                <a
                    href={rental.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 items-center gap-2.5 text-[13px] hover:underline"
                >
                    <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                        <IconFileText className="size-4" stroke={1.5} />
                    </span>
                    <span className="truncate font-medium">{rental.fileName ?? rental.fileUrl}</span>
                </a>
            ) : (
                <EmptyValue label={t("no-file")} />
            )}
        </SectionCard>
    )
}
