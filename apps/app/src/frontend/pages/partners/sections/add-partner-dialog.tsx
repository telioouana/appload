"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconArrowLeft, IconBuildingPlus, IconSearch, IconSend } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import type { ConnectionRelation } from "@workspace/db/connections"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { Label } from "@workspace/ui/components/label"
import { Badge } from "@workspace/ui/components/badge"
import { useDebouncedValue } from "@workspace/ui/hooks/use-debounced-value"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@workspace/ui/components/input-group"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useTRPC } from "@/backend/api/client"
import { CONNECTION_MESSAGE_MAX } from "@/backend/schemas/partner"
import { KycBadge } from "@/frontend/pages/partners/sections/badges"
import { RegisterPartnerForm } from "@/frontend/pages/partners/sections/register-partner-form"
import { usePartnerMutations } from "@/frontend/pages/partners/hooks/use-partner-mutations"
import { partnerKind, relationsFor, SEARCH_MIN_CHARS, type OrgType, type PartnerCandidate } from "@/frontend/pages/partners/types"

/**
 * How a partner gets onto the page. Two steps, in the order that keeps the
 * registry clean: look for the company first — nearly every Mozambican
 * carrier and shipper Appload works with is already in the database — and
 * only register one when the search and the NUIT both come up empty.
 */
export function AddPartnerDialog({
    orgType,
    initialRelation,
    open,
    onOpenChange,
}: {
    orgType: OrgType
    /** The relation the pills start on; a carrier can still switch */
    initialRelation: ConnectionRelation
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                {/* Mounted only while open, so a reopened dialog starts at the
                    search step rather than where it was left */}
                {open && <AddPartnerFlow orgType={orgType} initialRelation={initialRelation} onDone={() => onOpenChange(false)} />}
            </DialogContent>
        </Dialog>
    )
}

function AddPartnerFlow({
    orgType,
    initialRelation,
    onDone,
}: {
    orgType: OrgType
    initialRelation: ConnectionRelation
    onDone: () => void
}) {
    const t = useTranslations("App.partners")

    const relations = relationsFor(orgType)
    const [relation, setRelation] = useState<ConnectionRelation>(initialRelation)
    const [step, setStep] = useState<"search" | "register">("search")

    return (
        <>
            <DialogHeader>
                <DialogTitle>{t("add.title")}</DialogTitle>
                <DialogDescription>{t(`add.description.${step}`)}</DialogDescription>
            </DialogHeader>

            {relations.length > 1 && (
                <div role="radiogroup" aria-label={t("add.relation")} className="bg-muted flex w-fit gap-0.5 rounded-full p-1">
                    {relations.map((value) => {
                        const selected = value === relation

                        return (
                            <button
                                key={value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => setRelation(value)}
                                className={cn(
                                    "text-muted-foreground h-7 cursor-pointer rounded-full px-3 text-[13px] transition-colors",
                                    selected && "bg-background text-foreground font-medium shadow-sm",
                                )}
                            >
                                {t(`kind.${partnerKind(orgType, value)}`)}
                            </button>
                        )
                    })}
                </div>
            )}

            {step === "search" ? (
                // Keyed by the relation: switching what is being added
                // searches other companies, so the step starts over
                <SearchStep
                    key={relation}
                    relation={relation}
                    orgType={orgType}
                    onRegister={() => setStep("register")}
                    onDone={onDone}
                />
            ) : (
                <RegisterPartnerForm
                    relation={relation}
                    orgType={orgType}
                    onBack={() => setStep("search")}
                    onDone={onDone}
                />
            )}
        </>
    )
}

/**
 * Type-to-search over the companies of the counterpart type, then one
 * request with an optional note. A company that is already connected — or
 * already asked — is shown with its state instead of a button, so nobody
 * sends a request that would only come back as an error.
 */
function SearchStep({
    relation,
    orgType,
    onRegister,
    onDone,
}: {
    relation: ConnectionRelation
    orgType: OrgType
    onRegister: () => void
    onDone: () => void
}) {
    const t = useTranslations("App.partners")
    const trpc = useTRPC()
    const { request } = usePartnerMutations()

    const [query, setQuery] = useState("")
    const [selected, setSelected] = useState<PartnerCandidate | null>(null)
    const [message, setMessage] = useState("")

    const term = useDebouncedValue(query).trim()
    const enabled = term.length >= SEARCH_MIN_CHARS

    const { data, isFetching } = useQuery({
        ...trpc.partners.search.queryOptions({ query: term, relation }),
        enabled,
    })

    if (selected) {
        return (
            <>
                <div className="flex flex-col gap-4">
                    <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
                        <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">{selected.name}</span>
                            <span className="text-muted-foreground truncate text-xs">
                                {selected.province ?? t("values.no-province")}
                            </span>
                        </div>
                        <KycBadge status={selected.kycStatus} />
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="connection-message">{t("add.message.label")}</Label>
                        <Textarea
                            id="connection-message"
                            value={message}
                            maxLength={CONNECTION_MESSAGE_MAX}
                            placeholder={t("add.message.placeholder")}
                            onChange={(event) => setMessage(event.target.value)}
                        />
                        <p className="text-muted-foreground text-xs">{t("add.message.hint")}</p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" disabled={request.isPending} onClick={() => setSelected(null)}>
                        <IconArrowLeft stroke={1.5} />
                        {t("add.back")}
                    </Button>
                    <Button
                        disabled={request.isPending}
                        onClick={() => request.mutate(
                            { organizationId: selected.id, relation, message: message.trim() || undefined },
                            { onSuccess: onDone },
                        )}
                    >
                        {request.isPending ? <Spinner className="size-4" /> : <IconSend stroke={1.5} />}
                        {t("add.send")}
                    </Button>
                </DialogFooter>
            </>
        )
    }

    return (
        <>
            <div className="flex flex-col gap-3">
                <InputGroup>
                    <InputGroupAddon>
                        {isFetching ? <Spinner className="size-4" /> : <IconSearch className="size-4" stroke={1.5} />}
                    </InputGroupAddon>
                    <InputGroupInput
                        autoFocus
                        value={query}
                        placeholder={t(`add.search.${partnerKind(orgType, relation)}`)}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </InputGroup>

                <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                    {!enabled && <p className="text-muted-foreground px-1 py-6 text-center text-sm">{t("add.search.hint")}</p>}

                    {enabled && !isFetching && (data?.length ?? 0) === 0 && (
                        <p className="text-muted-foreground px-1 py-6 text-center text-sm">{t("add.search.empty")}</p>
                    )}

                    {data?.map((candidate) => (
                        <div key={candidate.id} className="hover:bg-muted/50 flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors">
                            <div className="flex min-w-0 flex-col">
                                <span className="truncate text-sm font-medium">{candidate.name}</span>
                                <span className="text-muted-foreground truncate text-xs">
                                    {candidate.province ?? t("values.no-province")}
                                </span>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                                <KycBadge status={candidate.kycStatus} />

                                {candidate.connection ? (
                                    <Badge variant="secondary" className="rounded-full font-normal">
                                        {t(candidate.connection.status === "accepted"
                                            ? "add.state.connected"
                                            : candidate.connection.direction === "incoming"
                                                ? "add.state.awaiting-you"
                                                : "add.state.pending")}
                                    </Badge>
                                ) : (
                                    <Button size="sm" variant="outline" onClick={() => { setMessage(""); setSelected(candidate) }}>
                                        {t("add.select")}
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <DialogFooter className="sm:justify-between">
                <p className="text-muted-foreground text-xs">{t("add.register-hint")}</p>
                <Button variant="outline" onClick={onRegister}>
                    <IconBuildingPlus stroke={1.5} />
                    {t("add.register")}
                </Button>
            </DialogFooter>
        </>
    )
}
