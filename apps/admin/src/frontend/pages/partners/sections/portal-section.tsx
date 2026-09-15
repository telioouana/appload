"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { IconCheck, IconMailForward, IconUserPlus, IconX } from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"
import { isAuthorized } from "@workspace/auth/user-permissions"
import { SUBSCRIPTION_PLAN, type SubscriptionPlan } from "@workspace/db/types"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { SelectItem } from "@workspace/ui/components/select"
import { FieldGroup } from "@workspace/ui/components/field"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { TextInput } from "@workspace/ui/inputs/text"
import { DateInput } from "@workspace/ui/inputs/date"
import { SelectInput } from "@workspace/ui/inputs/select"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@workspace/trpc/errors"
import { Mono } from "@workspace/ui/customs/list/table-cells"
import { useStaffRole } from "@/frontend/pages/kyc/sections/document-checklist"
import { DateValue, KeyValue, ProfileCard } from "@/frontend/pages/partners/sections/profile-parts"

const PORTAL_ERROR_CODES = ["ALREADY_DECIDED", "NOT_ALLOWED", "NOT_FOUND", "UNKNOWN"] as const

type PortalErrorCode = (typeof PORTAL_ERROR_CODES)[number]

type Translate = ReturnType<typeof useTranslations<"Admin.partners.portal">>

const inviteSchema = (t: Translate) => z.object({
    name: z.string().trim().nonempty({ error: t("errors.name") }),
    email: z.email({ error: t("errors.email") }),
})

const subscriptionSchema = z.object({
    // A select item cannot carry an empty value, so "no plan agreed" rides a
    // sentinel through the form and becomes null on the way to the mutation
    plan: z.enum(["none", ...SUBSCRIPTION_PLAN]),
    // The picker has no "no date" state of its own; the Clear button empties it
    expiresAt: z.date().optional(),
})

type InviteValues = z.infer<ReturnType<typeof inviteSchema>>
type SubscriptionValues = z.infer<typeof subscriptionSchema>

/**
 * The partner's standing on the self-serve portal, as ops sees it: whether
 * anybody signs in for this company, the claims waiting on a decision, who
 * holds an account or an open invitation, and the plan Appload agreed with
 * them. Everything here writes the same rows the portal itself reads.
 */
export function PortalSection({
    organizationId,
    portalActivatedAt,
    subscriptionPlan,
    subscriptionExpiresAt,
}: {
    organizationId: string
    portalActivatedAt: Date | null
    subscriptionPlan: SubscriptionPlan | null
    subscriptionExpiresAt: Date | null
}) {
    const t = useTranslations("Admin.partners.portal")
    const f = useFormatter()
    const now = useNow()
    const trpc = useTRPC()

    const claims = useQuery(trpc.partners.claims.queryOptions({ organizationId }))
    const access = useQuery(trpc.partners.portalMembers.queryOptions({ organizationId }))

    const [inviteOpen, setInviteOpen] = useState(false)

    const memberCount = access.data?.members.length ?? 0

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ProfileCard title={t("title")}>
                <p className="text-[13px]">
                    {portalActivatedAt ? (
                        <>
                            {t("since", { date: f.dateTime(portalActivatedAt, { dateStyle: "medium" }) })}
                            <span aria-hidden> · </span>
                            {t("members", { count: memberCount })}
                        </>
                    ) : (
                        <span className="text-muted-foreground">{t("inactive")}</span>
                    )}
                </p>
            </ProfileCard>

            <SubscriptionCard
                organizationId={organizationId}
                plan={subscriptionPlan}
                expiresAt={subscriptionExpiresAt}
            />

            <ProfileCard title={t("claims")} className="lg:col-span-2">
                {claims.isPending && <Spinner />}
                {claims.data && claims.data.length === 0 && (
                    <p className="text-muted-foreground text-[13px]">{t("no-claims")}</p>
                )}
                {claims.data?.map((claim) => (
                    <ClaimRow
                        key={claim.id}
                        claim={claim}
                        matchesOnFile={claim.userEmail.toLowerCase() === claim.organizationEmail.toLowerCase()}
                    />
                ))}
            </ProfileCard>

            <ProfileCard
                title={t("access")}
                className="lg:col-span-2"
                aside={
                    <Button variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
                        <IconUserPlus className="size-4" stroke={1.5} />
                        {t("invite")}
                    </Button>
                }
            >
                {access.isPending && <Spinner />}

                {access.data && (
                    <dl className="flex flex-col gap-2">
                        {access.data.members.length === 0 && (
                            <p className="text-muted-foreground text-[13px]">{t("no-members")}</p>
                        )}

                        {access.data.members.map((row) => (
                            <KeyValue key={row.id} label={row.name}>
                                <Mono>{row.email}</Mono>
                                <Badge variant="secondary">{t(`role.${roleLabel(row.role)}`)}</Badge>
                            </KeyValue>
                        ))}

                        {access.data.invitations.length > 0 && (
                            <>
                                <p className="text-muted-foreground mt-2 text-xs">{t("invitations")}</p>
                                {access.data.invitations.map((row) => (
                                    <KeyValue key={row.id} label={row.name}>
                                        <Mono>{row.email}</Mono>
                                        {row.expiresAt.getTime() < now.getTime() ? (
                                            <Badge variant="destructive">{t("invitation-expired")}</Badge>
                                        ) : (
                                            <span className="text-muted-foreground text-xs">
                                                {t("invitation-expires")} <DateValue value={row.expiresAt} />
                                            </span>
                                        )}
                                    </KeyValue>
                                ))}
                            </>
                        )}
                    </dl>
                )}
            </ProfileCard>

            <InviteOwnerDialog organizationId={organizationId} open={inviteOpen} onOpenChange={setInviteOpen} />
        </div>
    )
}

/** Better Auth keeps whatever role string it was handed; keep the copy honest. */
const roleLabel = (role: string) => (role === "owner" || role === "admin" ? role : "member")

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

type Claim = {
    id: string
    createdAt: Date
    userName: string
    userEmail: string
    emailVerified: boolean
}

function ClaimRow({ claim, matchesOnFile }: { claim: Claim; matchesOnFile: boolean }) {
    const t = useTranslations("Admin.partners.portal")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const [rejectOpen, setRejectOpen] = useState(false)

    const decide = useMutation(trpc.partners.decideClaim.mutationOptions({
        onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.partners.pathKey() }),
    }))

    const approve = async () => {
        try {
            await decide.mutateAsync({ id: claim.id, decision: "approve" })
            toast(t("approved"))
        } catch (caught) {
            toast.error(t(`errors.${domainErrorCode<PortalErrorCode>(caught, PORTAL_ERROR_CODES, "UNKNOWN")}`))
        }
    }

    return (
        <div className="ring-foreground/5 flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 ring-1">
            <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[13px] font-medium">{claim.userName}</span>
                <span className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                    <Mono>{claim.userEmail}</Mono>
                    <span aria-hidden>·</span>
                    <DateValue value={claim.createdAt} />
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={claim.emailVerified ? "secondary" : "destructive"}>
                        {claim.emailVerified ? t("email-verified") : t("email-unverified")}
                    </Badge>
                    <Badge variant={matchesOnFile ? "secondary" : "outline"}>
                        {matchesOnFile ? t("email-match") : t("email-differs")}
                    </Badge>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" onClick={approve} disabled={decide.isPending}>
                    {decide.isPending ? <Spinner /> : <IconCheck className="size-4" stroke={1.5} />}
                    {t("approve")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)} disabled={decide.isPending}>
                    <IconX className="size-4" stroke={1.5} />
                    {t("reject")}
                </Button>
            </div>

            <RejectClaimDialog claimId={claim.id} open={rejectOpen} onOpenChange={setRejectOpen} />
        </div>
    )
}

/** Rejecting asks for a reason: it is what the claimant is emailed. */
function RejectClaimDialog({
    claimId,
    open,
    onOpenChange,
}: {
    claimId: string
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTranslations("Admin.partners.portal")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const [note, setNote] = useState("")
    const [error, setError] = useState<PortalErrorCode | null>(null)

    const decide = useMutation(trpc.partners.decideClaim.mutationOptions({
        onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.partners.pathKey() }),
    }))

    // Every way out of the dialog goes through here, so a failed attempt
    // never greets the next one
    const close = () => {
        setNote("")
        setError(null)
        onOpenChange(false)
    }

    const submit = async () => {
        setError(null)

        try {
            await decide.mutateAsync({ id: claimId, decision: "reject", note: note.trim() || undefined })
            toast(t("rejected"))
            close()
        } catch (caught) {
            setError(domainErrorCode<PortalErrorCode>(caught, PORTAL_ERROR_CODES, "UNKNOWN"))
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!decide.isPending && !next) close() }}>
            <DialogContent className="w-full sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("reject-title")}</DialogTitle>
                    <DialogDescription>{t("reject-description")}</DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-2">
                    <Label htmlFor="claim-note">{t("reject-note")}</Label>
                    <Textarea
                        id="claim-note"
                        rows={3}
                        maxLength={500}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder={t("reject-placeholder")}
                        disabled={decide.isPending}
                    />
                </div>

                {error && <Alert variant="destructive"><AlertDescription>{t(`errors.${error}`)}</AlertDescription></Alert>}

                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={close} disabled={decide.isPending}>
                        {t("cancel")}
                    </Button>
                    <Button type="button" onClick={submit} disabled={decide.isPending}>
                        {decide.isPending && <Spinner />}
                        {t("reject")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ---------------------------------------------------------------------------
// Invitation
// ---------------------------------------------------------------------------

function InviteOwnerDialog({
    organizationId,
    open,
    onOpenChange,
}: {
    organizationId: string
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTranslations("Admin.partners.portal")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const schema = useMemo(() => inviteSchema(t), [t])
    const form = useForm<InviteValues>({ resolver: zodResolver(schema), defaultValues: { name: "", email: "" } })
    const [error, setError] = useState<PortalErrorCode | null>(null)

    const invite = useMutation(trpc.partners.inviteOwner.mutationOptions({
        onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.partners.pathKey() }),
    }))

    useEffect(() => {
        if (open) form.reset({ name: "", email: "" })
    }, [open, form])

    // Every way out of the dialog goes through here, so a failed attempt
    // never greets the next one
    const close = () => {
        setError(null)
        onOpenChange(false)
    }

    const submit = async (values: InviteValues) => {
        setError(null)

        try {
            const result = await invite.mutateAsync({ organizationId, ...values })
            toast(t("invite-sent", { email: result.email }))
            close()
        } catch (caught) {
            setError(domainErrorCode<PortalErrorCode>(caught, PORTAL_ERROR_CODES, "UNKNOWN"))
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!invite.isPending && !next) close() }}>
            <DialogContent className="w-full sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("invite-title")}</DialogTitle>
                    <DialogDescription>{t("invite-description")}</DialogDescription>
                </DialogHeader>

                <form
                    id="invite-owner"
                    onSubmit={(event) => {
                        event.stopPropagation()
                        void form.handleSubmit(submit)(event)
                    }}
                >
                    <FieldGroup className="gap-4">
                        <TextInput
                            name="name"
                            control={form.control}
                            isPending={invite.isPending}
                            label={t("invite-name")}
                            placeholder={t("invite-name-placeholder")}
                        />
                        <TextInput
                            name="email"
                            control={form.control}
                            isPending={invite.isPending}
                            label={t("invite-email")}
                            placeholder={t("invite-email-placeholder")}
                        />
                    </FieldGroup>
                </form>

                {error && <Alert variant="destructive"><AlertDescription>{t(`errors.${error}`)}</AlertDescription></Alert>}

                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={close} disabled={invite.isPending}>
                        {t("cancel")}
                    </Button>
                    <Button type="submit" form="invite-owner" disabled={invite.isPending}>
                        {invite.isPending ? <Spinner /> : <IconMailForward className="size-4" stroke={1.5} />}
                        {t("invite-send")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

function SubscriptionCard({
    organizationId,
    plan,
    expiresAt,
}: {
    organizationId: string
    plan: SubscriptionPlan | null
    expiresAt: Date | null
}) {
    const t = useTranslations("Admin.partners.portal")
    const f = useFormatter()
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const role = useStaffRole()
    const canEdit = isAuthorized(role, "subscription", ["update"])

    // What the portal's gate sees for this partner, so ops reads the quota
    // off the same rows it enforces
    const usage = useQuery(trpc.partners.portalUsage.queryOptions({ organizationId }))

    const values = useMemo<SubscriptionValues>(
        () => ({ plan: plan ?? "none", expiresAt: expiresAt ?? undefined }),
        [plan, expiresAt],
    )

    const form = useForm<SubscriptionValues>({ resolver: zodResolver(subscriptionSchema), defaultValues: values })
    const [error, setError] = useState<PortalErrorCode | null>(null)

    useEffect(() => {
        form.reset(values)
    }, [values, form])

    const save = useMutation(trpc.organizations.setSubscription.mutationOptions({
        onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.partners.pathKey() }),
    }))

    const submit = async (next: SubscriptionValues) => {
        setError(null)

        try {
            await save.mutateAsync({
                id: organizationId,
                plan: next.plan === "none" ? null : next.plan,
                expiresAt: next.expiresAt ?? null,
            })
            toast(t("subscription-saved"))
        } catch (caught) {
            setError(domainErrorCode<PortalErrorCode>(caught, PORTAL_ERROR_CODES, "UNKNOWN"))
        }
    }

    // A role without the statement reads the plan but cannot touch it
    const locked = save.isPending || !canEdit

    // The allowance's period is a "YYYY-MM" key; its first day is all it takes
    // to name the month in the reader's language
    const month = usage.data ? f.dateTime(new Date(`${usage.data.period}-01`), { month: "long", year: "numeric" }) : ""

    const usageLine = !usage.data
        ? null
        : usage.data.plan === null
            ? t("usage-none")
            : usage.data.quota === null
                ? t("usage-unlimited", { month, used: usage.data.used })
                : t("usage", { month, used: usage.data.used, quota: usage.data.quota })

    return (
        <ProfileCard title={t("subscription")}>
            <form
                id="portal-subscription"
                onSubmit={(event) => {
                    event.stopPropagation()
                    void form.handleSubmit(submit)(event)
                }}
            >
                <FieldGroup className="gap-4">
                    <SelectInput name="plan" control={form.control} isPending={locked} label={t("plan")}>
                        <SelectItem value="none">{t("plan-none")}</SelectItem>
                        {SUBSCRIPTION_PLAN.map((tier) => (
                            <SelectItem key={tier} value={tier}>{t(`plan-${tier}`)}</SelectItem>
                        ))}
                    </SelectInput>

                    <DateInput
                        name="expiresAt"
                        control={form.control}
                        isPending={locked}
                        label={t("expires")}
                        placeholder={t("no-expiry")}
                        description={
                            canEdit ? (
                                <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground cursor-pointer underline underline-offset-2"
                                    onClick={() => form.setValue("expiresAt", undefined, { shouldDirty: true })}
                                >
                                    {t("clear-expiry")}
                                </button>
                            ) : undefined
                        }
                    />
                </FieldGroup>
            </form>

            {usageLine && <p className="text-muted-foreground text-xs">{usageLine}</p>}

            {error && <Alert variant="destructive"><AlertDescription>{t(`errors.${error}`)}</AlertDescription></Alert>}

            {canEdit ? (
                <Button type="submit" form="portal-subscription" size="sm" className="self-end" disabled={save.isPending}>
                    {save.isPending ? <Spinner /> : <IconCheck className="size-4" stroke={1.5} />}
                    {t("subscription-save")}
                </Button>
            ) : (
                <p className="text-muted-foreground text-xs">{t("subscription-locked")}</p>
            )}
        </ProfileCard>
    )
}
