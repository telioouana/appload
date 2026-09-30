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

import { useContractMutations } from "@/frontend/pages/contracts/hooks/use-contract-mutations"
import type { ContractDetail } from "@/frontend/pages/contracts/types"

/** What the bucket accepts for a signed paper. */
const ACCEPTED_FILES = ["application/pdf", "image/jpeg", "image/png"]

/**
 * The signed contract. Between the owner and the client only — a
 * transporter never reads it. The upload lands in EdgeStore first and the
 * address is written with the URL it returns, against the contract's own
 * folder, which is what the door checks.
 */
export function FileCard({ contract }: { contract: ContractDetail }) {
    const t = useTranslations("App.contracts.detail")

    const { edgestore } = useEdgeStore()
    const { setFile, fail } = useContractMutations()

    const [uploading, setUploading] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)

    const canManage = contract.role === "owner" && contract.permissions.canEdit
    const isPending = uploading || setFile.isPending

    async function upload(file: File) {
        setUploading(true)

        try {
            const { url } = await edgestore.apploadFiles.upload({ file, input: { path: contractFilePath(contract.id) } })
            setFile.mutate({ id: contract.id, expectedVersion: contract.version, url, name: file.name })
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
                        {t(contract.fileUrl ? "actions.replace" : "actions.upload")}
                    </Button>
                    {contract.fileUrl && (
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("actions.remove-file")}
                            disabled={isPending}
                            onClick={() => setFile.mutate({ id: contract.id, expectedVersion: contract.version, url: null, name: null })}
                        >
                            <IconTrash className="size-4" stroke={1.5} />
                        </Button>
                    )}
                </div>
            ) : undefined}
        >
            {contract.fileUrl ? (
                <a
                    href={contract.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 items-center gap-2.5 text-[13px] hover:underline"
                >
                    <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
                        <IconFileText className="size-4" stroke={1.5} />
                    </span>
                    <span className="truncate font-medium">{contract.fileName ?? contract.fileUrl}</span>
                </a>
            ) : (
                <EmptyValue label={t("no-file")} />
            )}
        </SectionCard>
    )
}
