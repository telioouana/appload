"use client"

import { useRef, useState } from "react"
import { IconPaperclip, IconSend, IconX } from "@tabler/icons-react"

import { Button } from "@workspace/ui/components/button"
import {
    InputGroup,
    InputGroupAddon,
    InputGroupTextarea,
} from "@workspace/ui/components/input-group"
import { Spinner } from "@workspace/ui/components/spinner"

export type ChatComposerLabels = {
    placeholder: string
    send: string
    attach: string
    remove: string
    /** A file the bucket would refuse: wrong type, or too big */
    badType: string
    tooLarge: string
    tooMany: string
}

/**
 * What a party writes into the conversation: a line, some files, or both.
 *
 * Props only, like the panel above it. Sending is the page's business — this
 * hands it the trimmed body and the picked files and clears itself only when
 * the page says the message landed, so a refused send keeps what was typed.
 */
export function ChatComposer({
    onSend,
    disabled = false,
    pending = false,
    accept,
    maxBytes,
    maxFiles,
    labels,
}: {
    /** Resolves true when the message was stored; false leaves the draft alone */
    onSend: (body: string, files: File[]) => Promise<boolean>
    disabled?: boolean
    pending?: boolean
    /** The mime types the bucket takes */
    accept: string[]
    maxBytes: number
    maxFiles: number
    labels: ChatComposerLabels
}) {
    const inputRef = useRef<HTMLInputElement>(null)

    const [body, setBody] = useState("")
    const [files, setFiles] = useState<File[]>([])
    const [error, setError] = useState<string | null>(null)

    // `pending` is the caller's send mutation, which only starts once the
    // files are up: the upload runs inside `onSend` and would otherwise leave
    // the button live for as long as the attachments take, so this holds the
    // whole send — upload included — and a second Enter cannot post twice
    const [sending, setSending] = useState(false)

    const busy = disabled || pending || sending
    const empty = body.trim().length === 0 && files.length === 0

    const pick = (list: FileList | null) => {
        if (!list) return
        setError(null)

        const chosen = [...list]

        if (chosen.some((file) => !accept.includes(file.type))) return setError(labels.badType)
        if (chosen.some((file) => file.size > maxBytes)) return setError(labels.tooLarge)
        if (files.length + chosen.length > maxFiles) return setError(labels.tooMany)

        setFiles((current) => [...current, ...chosen])
    }

    const submit = async () => {
        if (busy || empty) return

        setError(null)
        setSending(true)

        try {
            if (await onSend(body.trim(), files)) {
                setBody("")
                setFiles([])
            }
        } finally {
            setSending(false)
        }
    }

    return (
        <div className="flex flex-col gap-1.5">
            <InputGroup>
                <InputGroupTextarea
                    value={body}
                    rows={2}
                    disabled={busy}
                    placeholder={labels.placeholder}
                    onChange={(event) => setBody(event.target.value)}
                    // Enter sends, as in every chat; a new line is Shift+Enter
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault()
                            void submit()
                        }
                    }}
                />

                {files.length > 0 && (
                    <InputGroupAddon align="block-start" className="flex-wrap gap-1.5">
                        {files.map((file, index) => (
                            <span
                                key={`${file.name}-${index}`}
                                className="bg-muted inline-flex max-w-48 items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                            >
                                <span className="truncate">{file.name}</span>
                                <button
                                    type="button"
                                    disabled={busy}
                                    aria-label={labels.remove}
                                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                                >
                                    <IconX className="size-3.5" stroke={1.5} />
                                </button>
                            </span>
                        ))}
                    </InputGroupAddon>
                )}

                <InputGroupAddon align="block-end">
                    <input
                        ref={inputRef}
                        type="file"
                        multiple
                        hidden
                        accept={accept.join(",")}
                        onChange={(event) => {
                            pick(event.target.files)
                            // Let the same file be re-picked after a removal
                            event.target.value = ""
                        }}
                    />

                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy || files.length >= maxFiles}
                        onClick={() => inputRef.current?.click()}
                    >
                        <IconPaperclip stroke={1.5} />
                        <span className="sr-only">{labels.attach}</span>
                    </Button>

                    <Button
                        type="button"
                        size="sm"
                        className="ml-auto"
                        disabled={busy || empty}
                        onClick={() => void submit()}
                    >
                        {pending || sending ? <Spinner className="size-4" /> : <IconSend stroke={1.5} />}
                        {labels.send}
                    </Button>
                </InputGroupAddon>
            </InputGroup>

            {error && <p className="text-destructive px-1 text-xs">{error}</p>}
        </div>
    )
}
