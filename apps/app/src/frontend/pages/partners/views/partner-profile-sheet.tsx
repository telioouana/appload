"use client"

import { useQuery } from "@tanstack/react-query"
import { IconCheck, IconLinkOff, IconUserMinus, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Separator } from "@workspace/ui/components/separator"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { StatusBadge } from "@workspace/ui/customs/badge/status-badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { initials } from "@workspace/ui/customs/list/table-cells"
import { useTRPC } from "@/backend/api/client"
import { usePartnerSheet } from "@/frontend/pages/partners/hooks/use-partner-sheet"
import { usePartnerMutations } from "@/frontend/pages/partners/hooks/use-partner-mutations"
import { ConnectionStatusChip, KycBadge, RelationChip } from "@/frontend/pages/partners/sections/badges"
import type { OrgType, PartnerProfile } from "@/frontend/pages/partners/types"

/**
 * The profile panel the page mounts once. Which connection it shows comes
 * from the URL, so a row click, a request card and a shared link all open
 * the same thing.
 *
 * What it can show depends on the connection: contact details and the
 * orders the two companies ran together are the reward for an accepted one,
 * and the server sends nothing else until then.
 */
export function PartnerProfileSheet({ orgType }: { orgType: OrgType }) {
    const t = useTranslations("App.partners.profile")
    const { id, close } = usePartnerSheet()

    return (
        <Sheet open={Boolean(id)} onOpenChange={(next) => { if (!next) close() }}>
            <SheetContent
                side="right"
                className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-[560px]"
            >
                <SheetHeader className="sr-only">
                    <SheetTitle>{t("title")}</SheetTitle>
                    <SheetDescription>{t("description")}</SheetDescription>
                </SheetHeader>

                {id && <Panel key={id} id={id} orgType={orgType} onClose={close} />}
            </SheetContent>
        </Sheet>
    )
}

function Panel({ id, orgType, onClose }: { id: string; orgType: OrgType; onClose: () => void }) {
    const t = useTranslations("App.partners")
    const trpc = useTRPC()

    const { data, isPending, isError } = useQuery(trpc.partners.profile.queryOptions({ id }))

    if (isPending) {
        return (
            <div className="flex flex-col gap-4 p-6">
                <Skeleton className="h-12 w-12 rounded-full" />
                <Skeleton className="h-6 w-48 rounded-md" />
                <Skeleton className="h-4 w-64 rounded-md" />
                <Skeleton className="h-40 w-full rounded-2xl" />
            </div>
        )
    }

    if (isError || !data) {
        return <p className="text-destructive p-6 text-sm">{t("profile.error")}</p>
    }

    return <Profile profile={data} orgType={orgType} onClose={onClose} />
}

function Profile({
    profile,
    orgType,
    onClose,
}: {
    profile: PartnerProfile
    orgType: OrgType
    onClose: () => void
}) {
    const t = useTranslations("App.partners")
    const f = useFormatter()
    const { respond, remove, withdraw } = usePartnerMutations()

    const { connection, partner, orders } = profile
    const isWorking = respond.isPending || remove.isPending || withdraw.isPending

    const address = partner.physicalAddress?.address ?? null
    const billing = partner.billingAddress?.address ?? null

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-col gap-3 px-6 pt-6 pb-4">
                <div className="flex items-center gap-3">
                    <Avatar className="size-12">
                        <AvatarFallback className="text-sm font-medium">{initials(partner.name)}</AvatarFallback>
                    </Avatar>

                    <div className="flex min-w-0 flex-col gap-0.5">
                        <h2 className="font-heading truncate text-xl font-semibold tracking-tight">{partner.name}</h2>
                        <span className="text-muted-foreground truncate text-sm">
                            {partner.province ?? t("values.no-province")}
                        </span>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <RelationChip relation={connection.relation} orgType={orgType} />
                    <KycBadge status={partner.kycStatus} />
                    <ConnectionStatusChip status={connection.status} />
                </div>
            </div>

            <Separator />

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-6">
                    <section className="flex flex-col gap-2">
                        <SectionTitle>{t("profile.contact")}</SectionTitle>

                        {connection.status === "accepted" ? (
                            <dl className="flex flex-col gap-2">
                                <Detail label={t("profile.fields.email")} value={partner.email} />
                                <Detail label={t("profile.fields.phone")} value={partner.phoneNumber} />
                                <Detail label={t("profile.fields.address")} value={address} />
                                <Detail label={t("profile.fields.billing")} value={billing} />
                            </dl>
                        ) : (
                            <p className="text-muted-foreground text-sm">{t("profile.locked")}</p>
                        )}
                    </section>

                    <section className="flex flex-col gap-2">
                        <SectionTitle>{t("profile.connection")}</SectionTitle>

                        <dl className="flex flex-col gap-2">
                            <Detail
                                label={t("profile.fields.requested")}
                                value={f.dateTime(connection.createdAt, { dateStyle: "medium" })}
                            />
                            <Detail
                                label={t("profile.fields.answered")}
                                value={connection.respondedAt ? f.dateTime(connection.respondedAt, { dateStyle: "medium" }) : null}
                            />
                            <Detail
                                label={t("profile.fields.direction")}
                                value={t(`direction.${connection.direction}`)}
                            />
                        </dl>

                        {connection.message && (
                            <p className="text-muted-foreground bg-muted/40 rounded-xl px-3 py-2 text-sm">
                                {connection.message}
                            </p>
                        )}
                    </section>

                    {orders && (
                        <section className="flex flex-col gap-3">
                            <SectionTitle>{t("profile.orders")}</SectionTitle>

                            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                                <span className="text-2xl font-semibold tabular-nums">{orders.total.toLocaleString()}</span>
                                <span className="text-muted-foreground text-sm">
                                    {orders.lastLoadingDate
                                        ? t("profile.last-loading", { date: f.dateTime(orders.lastLoadingDate, { dateStyle: "medium" }) })
                                        : t("profile.no-orders")}
                                </span>
                            </div>

                            {orders.byStatus.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {orders.byStatus.map((entry) => (
                                        <StatusBadge
                                            key={entry.status}
                                            status={entry.status}
                                            label={`${t(`order-status.${entry.status}`)} · ${entry.count}`}
                                        />
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-3">
                {connection.status === "pending" && connection.direction === "incoming" && (
                    <>
                        <Button
                            variant="outline"
                            disabled={isWorking}
                            onClick={() => respond.mutate({ id: connection.id, decision: "decline" }, { onSuccess: onClose })}
                        >
                            <IconX stroke={1.5} />
                            {t("actions.decline")}
                        </Button>
                        <Button
                            disabled={isWorking}
                            onClick={() => respond.mutate({ id: connection.id, decision: "accept" })}
                        >
                            <IconCheck stroke={1.5} />
                            {t("actions.accept")}
                        </Button>
                    </>
                )}

                {connection.status === "pending" && connection.direction === "outgoing" && (
                    <Button
                        variant="outline"
                        disabled={isWorking}
                        onClick={() => withdraw.mutate({ id: connection.id }, { onSuccess: onClose })}
                    >
                        <IconLinkOff stroke={1.5} />
                        {t("actions.withdraw")}
                    </Button>
                )}

                {connection.status === "accepted" && (
                    <Button
                        variant="outline"
                        disabled={isWorking}
                        onClick={() => remove.mutate({ id: connection.id }, { onSuccess: onClose })}
                    >
                        <IconUserMinus stroke={1.5} />
                        {t("actions.remove")}
                    </Button>
                )}
            </div>
        </div>
    )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{children}</h3>
}

function Detail({ label, value }: { label: string; value: string | null }) {
    const t = useTranslations("App.partners")

    return (
        <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground text-sm">{label}</dt>
            <dd className={value ? "truncate text-sm" : "text-muted-foreground truncate text-sm"}>
                {value ?? t("values.missing")}
            </dd>
        </div>
    )
}
