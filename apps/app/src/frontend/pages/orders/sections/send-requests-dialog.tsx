"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconCheck, IconSearch, IconSend } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import type { KycStatus } from "@workspace/db/types"

import { cn } from "@workspace/ui/lib/utils"
import { Label } from "@workspace/ui/components/label"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { useDebouncedValue } from "@workspace/ui/hooks/use-debounced-value"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@workspace/ui/components/input-group"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useTRPC } from "@/backend/api/client"
import { initials } from "@workspace/ui/customs/list/table-cells"
import { KycBadge } from "@/frontend/pages/partners/sections/badges"
import { MAX_REQUEST_CARRIERS, REQUEST_MESSAGE_MAX } from "@/backend/schemas/order"

/**
 * Who the order goes out to. The list is the company's own accepted
 * transporter connections — nobody else can be asked, and the procedure
 * behind `onSend` re-checks every id against those connections — with the
 * transporters already asked shown as such rather than offered again.
 *
 * The send itself is the caller's: an Appload order's request round and a
 * portal load's quote round go through different doors, and the dialog only
 * collects who and what to say.
 */
type Scope = "connected" | "all"

/** One line of the list, whichever lookup fed it. */
type Candidate = { id: string; name: string; province: string | null; kycStatus: KycStatus; connected: boolean }

export function SendRequestsDialog({
    alreadyRequested,
    open,
    onOpenChange,
    pending,
    error,
    onSend,
    allowAll = false,
}: {
    /** Carrier organization ids with a live request on this order */
    alreadyRequested: string[]
    open: boolean
    onOpenChange: (open: boolean) => void
    pending: boolean
    /** Why the last send failed, already translated; null when it did not */
    error: string | null
    /** Resolves once the round went out (the dialog then clears and closes), rejects when it did not */
    onSend: (carrierOrgIds: string[], message: string | undefined) => Promise<unknown>
    /**
     * Offer every transporter on the portal beside the company's own: a
     * load's quote round may go that wide, an Appload order's may not
     */
    allowAll?: boolean
}) {
    const t = useTranslations("App.orders.requests")
    const trpc = useTRPC()

    const [query, setQuery] = useState("")
    const [scope, setScope] = useState<Scope>("connected")
    const [selected, setSelected] = useState<string[]>([])
    const [message, setMessage] = useState("")

    const term = useDebouncedValue(query).trim()

    // The company's transporters: a shipper's accepted `client-carrier`
    // connections, a transporter's subcontractors
    const partners = useQuery({
        ...trpc.partners.list.queryOptions({ kind: "transporters", query: term || undefined, page: 1, pageSize: 100 }),
        enabled: !allowAll,
    })
    // …or, for a load, whichever scope is picked, read through the load's own door
    const candidates = useQuery({
        ...trpc.movements.candidates.queryOptions({ query: term || undefined, scope }),
        enabled: allowAll,
    })

    const isFetching = allowAll ? candidates.isFetching : partners.isFetching
    const asked = useMemo(() => new Set(alreadyRequested), [alreadyRequested])
    const carriers: Candidate[] = allowAll
        ? candidates.data ?? []
        : (partners.data?.items ?? []).map((row) => ({ ...row.partner, connected: true }))

    const toggle = (id: string) =>
        setSelected((current) => current.includes(id)
            ? current.filter((value) => value !== id)
            : current.length >= MAX_REQUEST_CARRIERS ? current : [...current, id])

    function send() {
        onSend(selected, message.trim() || undefined).then(
            () => {
                setSelected([])
                setMessage("")
                onOpenChange(false)
            },
            // The caller shows the reason through `error`
            () => undefined,
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{t("send.title")}</DialogTitle>
                    <DialogDescription>{t(allowAll ? "send.description-all" : "send.description")}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    {allowAll && (
                        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("send.scope.label")}>
                            {(["connected", "all"] as const).map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    role="radio"
                                    aria-checked={scope === value}
                                    disabled={pending}
                                    onClick={() => setScope(value)}
                                    className={cn(
                                        "cursor-pointer rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-50",
                                        scope === value ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
                                    )}
                                >
                                    {t(`send.scope.${value}`)}
                                </button>
                            ))}
                        </div>
                    )}

                    <InputGroup>
                        <InputGroupAddon>
                            {isFetching ? <Spinner className="size-4" /> : <IconSearch className="size-4" stroke={1.5} />}
                        </InputGroupAddon>
                        <InputGroupInput
                            autoFocus
                            value={query}
                            placeholder={t("send.search")}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                    </InputGroup>

                    <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                        {carriers.length === 0 && !isFetching && (
                            <p className="text-muted-foreground px-1 py-6 text-center text-sm">{t("send.empty")}</p>
                        )}

                        {carriers.map((row) => {
                            const already = asked.has(row.id)
                            const checked = selected.includes(row.id)

                            return (
                                <button
                                    key={row.id}
                                    type="button"
                                    role="checkbox"
                                    aria-checked={checked}
                                    disabled={already || pending}
                                    onClick={() => toggle(row.id)}
                                    className={cn(
                                        "hover:bg-muted/60 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                                        "disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent",
                                        checked && "bg-primary/5",
                                    )}
                                >
                                    <span className={cn(
                                        "flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                                        checked ? "bg-primary border-primary text-primary-foreground" : "border-ring bg-input/50",
                                    )}>
                                        {checked && <IconCheck className="size-3" stroke={2.5} />}
                                    </span>

                                    <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                                        {initials(row.name)}
                                    </span>

                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate text-sm font-medium">{row.name}</span>
                                        <span className="text-muted-foreground truncate text-xs">
                                            {already ? t("send.already")
                                                : [row.province ?? t("send.no-province"), !row.connected && t("send.not-connected")].filter(Boolean).join(" · ")}
                                        </span>
                                    </span>

                                    <span className="ml-auto shrink-0">
                                        <KycBadge status={row.kycStatus} />
                                    </span>
                                </button>
                            )
                        })}
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="request-message">{t("send.message.label")}</Label>
                        <Textarea
                            id="request-message"
                            value={message}
                            rows={3}
                            maxLength={REQUEST_MESSAGE_MAX}
                            placeholder={t("send.message.placeholder")}
                            onChange={(event) => setMessage(event.target.value)}
                        />
                        <p className="text-muted-foreground text-xs">{t("send.message.hint")}</p>
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter className="sm:justify-between">
                    <p className="text-muted-foreground text-xs">
                        {t("send.selected", { count: selected.length, max: MAX_REQUEST_CARRIERS })}
                    </p>

                    <Button disabled={selected.length === 0 || pending} onClick={send}>
                        {pending ? <Spinner className="size-4" /> : <IconSend stroke={1.5} />}
                        {t("send.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
