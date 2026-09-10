"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconCheck, IconSearch, IconSend } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

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
import { orderErrorKey, type OrderErrorMessage } from "@/frontend/pages/orders/lib/errors"
import { useOrderMutations } from "@/frontend/pages/orders/hooks/use-order-mutations"
import { MAX_REQUEST_CARRIERS, REQUEST_MESSAGE_MAX } from "@/backend/schemas/order"

/**
 * Who the order goes out to. The list is the client's own accepted carrier
 * connections — nobody else can be asked, and the procedure re-checks every
 * id against those connections — with the carriers already asked shown as
 * such rather than offered again.
 */
export function SendRequestsDialog({
    orderId,
    alreadyRequested,
    open,
    onOpenChange,
}: {
    orderId: string
    /** Carrier organization ids with a live request on this order */
    alreadyRequested: string[]
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTranslations("App.orders.requests")
    const tError = useTranslations("App.orders")
    const trpc = useTRPC()

    const { sendRequests } = useOrderMutations()

    const [query, setQuery] = useState("")
    const [selected, setSelected] = useState<string[]>([])
    const [message, setMessage] = useState("")
    const [error, setError] = useState<OrderErrorMessage | null>(null)

    const term = useDebouncedValue(query).trim()

    const { data, isFetching } = useQuery(trpc.partners.list.queryOptions({
        relation: "client-carrier",
        status: "accepted",
        query: term || undefined,
        page: 1,
        pageSize: 100,
    }))

    const asked = useMemo(() => new Set(alreadyRequested), [alreadyRequested])
    const carriers = data?.items ?? []

    const toggle = (id: string) =>
        setSelected((current) => current.includes(id)
            ? current.filter((value) => value !== id)
            : current.length >= MAX_REQUEST_CARRIERS ? current : [...current, id])

    function send() {
        setError(null)

        sendRequests.mutate(
            {
                orderId,
                carrierOrgIds: selected,
                message: message.trim() || undefined,
            },
            {
                onSuccess: () => {
                    setSelected([])
                    setMessage("")
                    onOpenChange(false)
                },
                onError: (failure) => setError(orderErrorKey(failure)),
            },
        )
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) { setError(null) } onOpenChange(next) }}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{t("send.title")}</DialogTitle>
                    <DialogDescription>{t("send.description")}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3">
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
                            const already = asked.has(row.partner.id)
                            const checked = selected.includes(row.partner.id)

                            return (
                                <button
                                    key={row.id}
                                    type="button"
                                    role="checkbox"
                                    aria-checked={checked}
                                    disabled={already || sendRequests.isPending}
                                    onClick={() => toggle(row.partner.id)}
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
                                        {initials(row.partner.name)}
                                    </span>

                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate text-sm font-medium">{row.partner.name}</span>
                                        <span className="text-muted-foreground truncate text-xs">
                                            {already ? t("send.already") : row.partner.province ?? t("send.no-province")}
                                        </span>
                                    </span>

                                    <span className="ml-auto shrink-0">
                                        <KycBadge status={row.partner.kycStatus} />
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
                            <AlertDescription>{tError(`errors.${error}`)}</AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter className="sm:justify-between">
                    <p className="text-muted-foreground text-xs">
                        {t("send.selected", { count: selected.length, max: MAX_REQUEST_CARRIERS })}
                    </p>

                    <Button disabled={selected.length === 0 || sendRequests.isPending} onClick={send}>
                        {sendRequests.isPending ? <Spinner className="size-4" /> : <IconSend stroke={1.5} />}
                        {t("send.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
