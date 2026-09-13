"use client"

import { toast } from "sonner"
import { useRef, useState } from "react"
import { IconUpload } from "@tabler/icons-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"
import { useEdgeStore } from "@workspace/edgestore/client"

import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@workspace/ui/components/dialog"

import { useTRPC } from "@/backend/api/client"

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"]
const MAX_BYTES = 5 * 1024 * 1024

/**
 * Files the contract the company signed with Appload.
 *
 * Two-phase commit, as in Admin's own upload: the scan lands in EdgeStore as
 * `temporary`, the document row is written, and only then is the file
 * confirmed — a mutation that fails leaves a blob that expires on its own
 * rather than an orphaned scan sitting in storage.
 *
 * The expiry is asked for here and not left optional: a contract with no end
 * date can never be read as expired, so partners would keep seeing it as
 * valid long after it ran out.
 */
export function ContractUploadDialog({ organizationId }: { organizationId: string }) {
    const t = useTranslations("App.settings.company")
    const trpc = useTRPC()
    const queryClient = useQueryClient()
    const { edgestore } = useEdgeStore()
    const fileRef = useRef<HTMLInputElement>(null)

    const upload = useMutation(trpc.me.uploadContract.mutationOptions())

    const [open, setOpen] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [expiresAt, setExpiresAt] = useState("")
    const [error, setError] = useState<"size" | "type" | null>(null)
    const [busy, setBusy] = useState(false)

    const isPending = busy || upload.isPending

    function pick(chosen: File | null) {
        setError(null)

        if (!chosen) return setFile(null)
        if (!ACCEPTED.includes(chosen.type)) return setError("type")
        if (chosen.size > MAX_BYTES) return setError("size")

        setFile(chosen)
    }

    async function submit() {
        if (!file || !expiresAt || isPending) return

        setBusy(true)

        try {
            const { url } = await edgestore.kycFiles.upload({
                file,
                input: { subjectType: "organization", subjectId: organizationId, docType: "signed-contract" },
                // Not confirmed until the row exists
                options: { temporary: true },
            })

            await upload.mutateAsync({
                pages: [{ url, size: file.size, mimeType: file.type }],
                expiresAt,
            })

            // The row is durable; the file can stop being temporary
            await edgestore.kycFiles.confirmUpload({ url })

            void queryClient.invalidateQueries(trpc.me.contract.queryFilter())

            setFile(null)
            setExpiresAt("")
            setOpen(false)
            toast.success(t("contract.dialog.success"))
        } catch (failure) {
            console.error(failure)
            toast.error(t("errors.UNKNOWN"))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (isPending) return
                setOpen(next)
                if (!next) setError(null)
            }}
        >
            <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                    <IconUpload />
                    {t("contract.upload")}
                </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("contract.dialog.title")}</DialogTitle>
                    <DialogDescription>{t("contract.dialog.description")}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <input
                                ref={fileRef}
                                type="file"
                                className="hidden"
                                accept={ACCEPTED.join(",")}
                                onChange={(event) => {
                                    pick(event.target.files?.[0] ?? null)
                                    // Let the same file be re-picked after a removal
                                    event.target.value = ""
                                }}
                            />

                            <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => fileRef.current?.click()}>
                                <IconUpload />
                                {t("contract.dialog.file")}
                            </Button>

                            {/* Picking again replaces it, so there is nothing
                                to remove — only a name to read back */}
                            {file && (
                                <span className="text-muted-foreground min-w-0 truncate text-xs">{file.name}</span>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="contract-expires">{t("contract.dialog.expires")}</Label>
                        <Input
                            id="contract-expires"
                            type="date"
                            value={expiresAt}
                            disabled={isPending}
                            onChange={(event) => setExpiresAt(event.target.value)}
                        />
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{t(`contract.dialog.errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button disabled={!file || !expiresAt || isPending} onClick={() => void submit()}>
                        {isPending && <Spinner className="size-4" />}
                        {t("contract.dialog.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
