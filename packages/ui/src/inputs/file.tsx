"use client"

import { toast } from "sonner"
import { useRef, useState } from "react"
import { useTranslations } from "@workspace/i18n"
import { IconTrash, IconUpload, IconCircleX } from "@tabler/icons-react"

import { Base } from "@workspace/ui/inputs/base"
import { Spinner } from "@workspace/ui/components/spinner"
import { ControlFunc } from "@workspace/ui/inputs/types"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from "@workspace/ui/components/input-group"

import { useEdgeStore } from "@workspace/edgestore/client"
import { toStoragePath } from "@workspace/edgestore/path"

const DEFAULT_ACCEPT = ["application/pdf", "image/jpeg", "image/png"]

/**
 * Single file input for both upload strategies:
 *
 * - `mode="upload"` (default): the pick is uploaded to EdgeStore right away
 *   and the form value is the resulting URL. Requires a session (the bucket
 *   rejects anonymous uploads) plus the bucket's `path` input.
 * - `mode="deferred"`: the form value is the raw `File` (or `File[]` with
 *   `multiple`); nothing touches the network. For flows where no session
 *   exists yet (e.g. sign-up KYC) — the caller uploads later.
 *
 * Picks failing `accept`/`maxSize` are rejected with a toast in both modes;
 * pass `formatError`/`sizeError` to localize them per field.
 */
export const FileInput: ControlFunc<{
    mode?: "upload" | "deferred"
    buttonLabel?: string
    accept?: string[]
    maxSize?: number
    sizeError?: string
    formatError?: string
    // deferred mode
    multiple?: boolean
    maxFiles?: number
    // upload mode: EdgeStore bucket input
    path?: string
    // upload mode: rendered as part of a field array
    index?: number
    length?: number
    remove?: (index: number, path?: string) => void
}> = ({
    mode = "upload",
    buttonLabel,
    accept = DEFAULT_ACCEPT,
    maxSize,
    sizeError,
    formatError,
    multiple,
    maxFiles,
    path,
    index,
    length,
    remove,
    ...props
}) => {
    const inputRef = useRef<HTMLInputElement>(null)
    const [isSubmitting, setSubmitting] = useState<boolean>(false)

    const isDisabled = isSubmitting || props.isPending
    const t = useTranslations("General.inputs.file")
    const { edgestore } = useEdgeStore()

    // Shared pick guard: drops files the field does not accept, one toast
    // per rejection, and returns whatever survived
    function filterPicked(picked: FileList | null): File[] {
        if (!picked?.length) return []

        const accepted: File[] = []
        for (const file of Array.from(picked)) {
            if (!accept.includes(file.type)) {
                toast(formatError ?? t("errors.format"))
                continue
            }
            if (maxSize && file.size > maxSize) {
                toast(sizeError ?? t("errors.size"))
                continue
            }
            accepted.push(file)
        }
        return accepted
    }

    return (
        <Base {...props}>
            {(field) => {
                const files: File[] =
                    mode === "deferred"
                        ? multiple
                            ? ((field.value as File[] | undefined) ?? [])
                            : field.value
                              ? [field.value as File]
                              : []
                        : []

                const isFull =
                    mode === "deferred" &&
                    files.length >= (multiple ? (maxFiles ?? 1) : 1)

                async function discard(url?: string) {
                    if (!url) return
                    setSubmitting(true)
                    try {
                        await edgestore.apploadFiles.delete({ url })
                        field.onChange(undefined)
                    } catch (error) {
                        toast(t("delete.error"))
                        console.log(error)
                    } finally {
                        setSubmitting(false)
                    }
                }

                async function upload(file: File) {
                    setSubmitting(true)
                    try {
                        const { url } = await edgestore.apploadFiles.upload({
                            file,
                            options: {
                                temporary: true,
                                ...(field.value
                                    ? { replaceTargetUrl: field.value }
                                    : {}),
                            },
                            // Folded, not passed through: callers build this
                            // from real-world data (ids, plates, names) and
                            // an illegal character fails the upload with an
                            // opaque "Internal server error"
                            input: { path: toStoragePath(path ?? "") },
                        })

                        if (!url) {
                            toast(t("upload.error"))
                            return
                        }
                        field.onChange(url)
                    } catch (error) {
                        toast(t("upload.error"))
                        console.log(error)
                    } finally {
                        setSubmitting(false)
                    }
                }

                async function onPick(picked: FileList | null) {
                    const accepted = filterPicked(picked)
                    if (inputRef.current) inputRef.current.value = ""
                    if (!accepted.length) return

                    if (mode === "deferred") {
                        if (multiple) {
                            field.onChange(
                                [...files, ...accepted].slice(0, maxFiles ?? 1)
                            )
                        } else {
                            field.onChange(accepted[0])
                        }
                        return
                    }

                    await upload(accepted[0]!)
                }

                const showDelete = mode === "upload" && Boolean(field.value)

                return (
                    <InputGroup>
                        <InputGroupAddon align="inline-start">
                            {showDelete ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <InputGroupButton
                                            type="button"
                                            variant="destructive"
                                            disabled={isDisabled}
                                            onClick={() =>
                                                discard(field.value)
                                            }
                                        >
                                            {t("delete.label")}
                                            {isSubmitting ? (
                                                <Spinner />
                                            ) : (
                                                <IconTrash className="text-destructive" />
                                            )}
                                        </InputGroupButton>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t("delete.tooltip")}
                                    </TooltipContent>
                                </Tooltip>
                            ) : (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <InputGroupButton
                                            type="button"
                                            variant="default"
                                            disabled={isDisabled || isFull}
                                            onClick={() =>
                                                inputRef.current?.click()
                                            }
                                        >
                                            {buttonLabel ?? t("upload.label")}
                                            {isSubmitting ? (
                                                <Spinner />
                                            ) : (
                                                <IconUpload />
                                            )}
                                        </InputGroupButton>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t("upload.tooltip")}
                                    </TooltipContent>
                                </Tooltip>
                            )}
                        </InputGroupAddon>

                        <InputGroupInput
                            ref={inputRef}
                            type="file"
                            className="hidden"
                            multiple={mode === "deferred" && multiple}
                            accept={accept.join(",")}
                            onChange={(e) => onPick(e.target.files)}
                        />

                        <InputGroupInput
                            id={field.id}
                            aria-invalid={field["aria-invalid"]}
                            readOnly
                            type="text"
                            className="w-full"
                            value={
                                mode === "deferred"
                                    ? files.map((file) => file.name).join(", ")
                                    : (field.value ?? "")
                            }
                            disabled={props.isPending}
                            placeholder={props.placeholder}
                        />

                        {mode === "deferred" && files.length > 0 && (
                            <InputGroupAddon align="inline-end">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <InputGroupButton
                                            type="button"
                                            variant="destructive"
                                            disabled={props.isPending}
                                            onClick={() =>
                                                field.onChange(
                                                    multiple ? [] : undefined
                                                )
                                            }
                                        >
                                            <IconCircleX />
                                        </InputGroupButton>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t("delete.tooltip")}
                                    </TooltipContent>
                                </Tooltip>
                            </InputGroupAddon>
                        )}

                        {mode === "upload" &&
                            remove &&
                            index !== undefined &&
                            length !== undefined &&
                            index < length &&
                            length > 1 && (
                                <InputGroupAddon align="inline-end">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <InputGroupButton
                                                type="button"
                                                variant="destructive"
                                                disabled={isDisabled}
                                                onClick={() =>
                                                    remove(index, path)
                                                }
                                            >
                                                {t("remove.label")}
                                                <IconCircleX />
                                            </InputGroupButton>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t("remove.tooltip")}
                                        </TooltipContent>
                                    </Tooltip>
                                </InputGroupAddon>
                            )}
                    </InputGroup>
                )
            }}
        </Base>
    )
}
