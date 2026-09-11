"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconEdit, IconFileCheck, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { initials, Mono, PlateChip } from "@workspace/ui/customs/list/table-cells"
import { DocumentChecklist } from "@/frontend/pages/kyc/sections/document-checklist"
import { StandingMenu } from "@/frontend/pages/partners/sections/standing-menu"
import { PortalSection } from "@/frontend/pages/partners/sections/portal-section"
import { EditPartnerDialog, emptyLocation } from "@/frontend/pages/partners/sections/edit-partner-dialog"
import { ContractChip, KycBadge, OwnershipBadge, RiskBadge } from "@/frontend/pages/partners/sections/badges"
import {
    ActivityTab,
    DriverOverview,
    DriversTab,
    FleetTab,
    OrdersTab,
    OrganizationOverview,
    VehicleOverview,
} from "@/frontend/pages/partners/sections/profile-overview"
import { usePartnerProfile, type ProfileTab } from "@/frontend/pages/partners/hooks/use-partner-profile"
import { isPlaceholder, type VehicleKind } from "@/frontend/pages/partners/types"

type SubjectType = "organization" | "driver" | VehicleKind

type TabItem = { value: ProfileTab; label: string; count?: string | number }

/**
 * The profile panel every list page mounts once. Which record it shows
 * comes from the URL, so a row click, a ⌘K result and a shared link all
 * open the same thing. The panel owns the header and the tab strip; each
 * subject type fills in its own overview.
 */
export function PartnerProfileSheet({ subjectType }: { subjectType: SubjectType }) {
    const t = useTranslations("Admin.partners.profile")
    const { id, tab, close, setTab } = usePartnerProfile()

    return (
        <Sheet open={Boolean(id)} onOpenChange={(next) => { if (!next) close() }}>
            <SheetContent
                side="right"
                showCloseButton={false}
                className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-3/5 2xl:data-[side=right]:w-[920px]"
            >
                <SheetHeader className="sr-only">
                    <SheetTitle>{t("title")}</SheetTitle>
                    <SheetDescription>{t("description")}</SheetDescription>
                </SheetHeader>

                {id && subjectType === "organization" && <OrganizationPanel key={id} id={id} tab={tab} onTab={setTab} onClose={close} />}
                {id && subjectType === "driver" && <DriverPanel key={id} id={id} tab={tab} onTab={setTab} onClose={close} />}
                {id && subjectType !== "organization" && subjectType !== "driver" && (
                    <VehiclePanel key={id} kind={subjectType} id={id} tab={tab} onTab={setTab} onClose={close} />
                )}
            </SheetContent>
        </Sheet>
    )
}

type PanelProps = { id: string; tab: ProfileTab; onTab: (tab: ProfileTab) => void; onClose: () => void }

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function Frame({
    header,
    tabs,
    tab,
    onTab,
    footer,
    children,
}: {
    header: React.ReactNode
    tabs: TabItem[]
    tab: ProfileTab
    onTab: (tab: ProfileTab) => void
    footer?: React.ReactNode
    children: React.ReactNode
}) {
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="px-5 pt-5 pb-3 md:px-6">{header}</div>

            <div role="tablist" className="flex gap-4 overflow-x-auto border-b px-5 md:px-6">
                {tabs.map((item) => {
                    const active = item.value === tab

                    return (
                        <button
                            key={item.value}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => onTab(item.value)}
                            className={cn(
                                "text-muted-foreground hover:text-foreground -mb-px flex h-11 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 border-transparent text-sm whitespace-nowrap transition-colors",
                                active && "border-primary text-foreground font-medium",
                            )}
                        >
                            {item.label}
                            {item.count !== undefined && (
                                <span className={cn(
                                    "bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums",
                                    active && "bg-primary/12 text-primary",
                                )}>
                                    {item.count}
                                </span>
                            )}
                        </button>
                    )
                })}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">{children}</div>

            {footer && <div className="text-muted-foreground flex items-center justify-between border-t px-5 py-2.5 text-xs md:px-6">{footer}</div>}
        </div>
    )
}

function Header({
    image,
    fallback,
    name,
    subtitle,
    badges,
    actions,
    onClose,
}: {
    image?: string | null
    fallback: string
    name: string
    subtitle: React.ReactNode
    badges: React.ReactNode
    actions: React.ReactNode
    onClose: () => void
}) {
    const t = useTranslations("Admin.partners.profile")

    return (
        <div className="flex items-start gap-3.5">
            <Avatar className="size-12 shrink-0">
                {image && <AvatarImage src={image} alt={name} />}
                <AvatarFallback className="text-sm font-medium">{fallback}</AvatarFallback>
            </Avatar>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <h2 className="font-heading truncate text-lg font-semibold tracking-tight">{name}</h2>
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-[13px]">{subtitle}</div>
                <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
                {actions}
                <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("close")} className="bg-secondary">
                    <IconX className="size-4" stroke={1.5} />
                </Button>
            </div>
        </div>
    )
}

function PanelSkeleton() {
    return (
        <div className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-5 w-56 rounded-md" />
                    <Skeleton className="h-3.5 w-40 rounded-md" />
                </div>
            </div>
            <Skeleton className="h-10 w-full rounded-md" />
            <div className="grid grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-36 rounded-2xl" />)}
            </div>
        </div>
    )
}

function PanelError({ onClose }: { onClose: () => void }) {
    const t = useTranslations("Admin.partners.profile")

    return (
        <div className="flex flex-col gap-4 p-6">
            <Alert variant="destructive"><AlertDescription>{t("load-failed")}</AlertDescription></Alert>
            <Button variant="outline" onClick={onClose} className="self-start">{t("close")}</Button>
        </div>
    )
}

function Dot() {
    return <span aria-hidden>·</span>
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

function OrganizationPanel({ id, tab, onTab, onClose }: PanelProps) {
    const t = useTranslations("Admin.partners")
    const trpc = useTRPC()
    const query = useQuery(trpc.partners.organizationProfile.queryOptions({ id }))
    const [editOpen, setEditOpen] = useState(false)

    const profile = query.data

    const editValues = useMemo(() => profile ? {
        name: profile.name,
        nuit: isPlaceholder("nuit", profile.nuit) ? "" : profile.nuit,
        email: isPlaceholder("email", profile.email) ? "" : profile.email,
        phone: isPlaceholder("phone", profile.phoneNumber) ? "" : profile.phoneNumber,
        representee: profile.representee ?? "",
        billingAddress: profile.billingAddress ?? emptyLocation(),
        physicalAddress: profile.physicalAddress ?? emptyLocation(),
    } : null, [profile])

    if (query.isPending) return <PanelSkeleton />
    if (query.isError || !profile || !editValues) return <PanelError onClose={onClose} />

    // A shipper can keep a fleet of its own since the portal opened fleet
    // registration to it; staff see it here, where they would look for it
    const tabs: TabItem[] = [
        { value: "overview", label: t("profile.tabs.overview") },
        { value: "documents", label: t("profile.tabs.documents"), count: `${profile.progress.approved}/${profile.progress.required}` },
        { value: "fleet" as const, label: t("profile.tabs.fleet"), count: profile.fleet.trucks + profile.fleet.trailers + profile.fleet.links },
        { value: "drivers" as const, label: t("profile.tabs.drivers"), count: profile.fleet.drivers },
        { value: "orders", label: t("profile.tabs.orders"), count: profile.performance.totalOrders },
        { value: "portal", label: t("profile.tabs.portal") },
        { value: "activity", label: t("profile.tabs.activity") },
    ]

    return (
        <Frame
            tabs={tabs}
            tab={tab}
            onTab={onTab}
            header={
                <Header
                    image={profile.logo}
                    fallback={initials(profile.name)}
                    name={profile.name}
                    onClose={onClose}
                    subtitle={
                        <>
                            <span>{t(`profile.type.${profile.type}`)}</span>
                            <Dot />
                            <span>NUIT {isPlaceholder("nuit", profile.nuit) ? <span className="italic">{t("values.missing")}</span> : <Mono>{profile.nuit}</Mono>}</span>
                            {profile.city && <><Dot /><span>{profile.city}</span></>}
                        </>
                    }
                    badges={
                        <>
                            <KycBadge status={profile.kycStatus} />
                            {profile.contract && <ContractChip state={profile.contract} />}
                            <RiskBadge level={profile.riskLevel} reason={profile.riskReason} />
                        </>
                    }
                    actions={
                        <>
                            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                                <IconEdit className="size-4" stroke={1.5} />
                                <span className="hidden sm:inline">{t("profile.edit")}</span>
                            </Button>
                            <Button size="sm" onClick={() => onTab("documents")}>
                                <IconFileCheck className="size-4" stroke={1.5} />
                                <span className="hidden sm:inline">{t("profile.review")}</span>
                            </Button>
                            <StandingMenu
                                subjectType="organization"
                                subjectId={profile.id}
                                kycStatus={profile.kycStatus}
                                riskLevel={profile.riskLevel}
                                copy={isPlaceholder("nuit", profile.nuit) ? [] : [{ label: t("actions.copy-nuit"), value: profile.nuit }]}
                            />
                        </>
                    }
                />
            }
        >
            {tab === "overview" && <OrganizationOverview profile={profile} onOrders={() => onTab("orders")} />}
            {tab === "documents" && <DocumentChecklist subjectType="organization" subjectId={profile.id} />}
            {tab === "fleet" && <FleetTab organizationId={profile.id} />}
            {tab === "drivers" && <DriversTab organizationId={profile.id} />}
            {tab === "orders" && <OrdersTab subjectType={profile.type} subjectId={profile.id} />}
            {tab === "portal" && (
                <PortalSection
                    organizationId={profile.id}
                    portalActivatedAt={profile.portalActivatedAt}
                    subscriptionPlan={profile.subscriptionPlan}
                    subscriptionExpiresAt={profile.subscriptionExpiresAt}
                />
            )}
            {tab === "activity" && (
                <ActivityTab
                    subjectType="organization"
                    subjectId={profile.id}
                    risk={{ level: profile.riskLevel, reason: profile.riskReason, at: profile.riskFlaggedAt }}
                />
            )}

            <EditPartnerDialog
                target={{ kind: "organization", id: profile.id, values: editValues }}
                open={editOpen}
                onOpenChange={setEditOpen}
            />
        </Frame>
    )
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function DriverPanel({ id, tab, onTab, onClose }: PanelProps) {
    const t = useTranslations("Admin.partners")
    const trpc = useTRPC()
    const query = useQuery(trpc.partners.driverProfile.queryOptions({ id }))
    const [editOpen, setEditOpen] = useState(false)

    const profile = query.data

    const editValues = useMemo(() => profile ? {
        name: profile.name,
        email: isPlaceholder("email", profile.email) ? "" : profile.email,
        phoneNumber: isPlaceholder("phone", profile.phoneNumber) ? "" : (profile.phoneNumber ?? ""),
        passport: profile.passport ?? "",
    } : null, [profile])

    if (query.isPending) return <PanelSkeleton />
    if (query.isError || !profile || !editValues) return <PanelError onClose={onClose} />

    const tabs: TabItem[] = [
        { value: "overview", label: t("profile.tabs.overview") },
        { value: "documents", label: t("profile.tabs.documents"), count: `${profile.progress.approved}/${profile.progress.required}` },
        { value: "orders", label: t("profile.tabs.orders"), count: profile.performance.totalOrders },
        { value: "activity", label: t("profile.tabs.activity") },
    ]

    return (
        <Frame
            tabs={tabs}
            tab={tab}
            onTab={onTab}
            header={
                <Header
                    image={profile.image}
                    fallback={initials(profile.name)}
                    name={profile.name}
                    onClose={onClose}
                    subtitle={
                        <>
                            <span>{t("profile.type.driver")}</span>
                            {profile.carrierName && <><Dot /><span>{profile.carrierName}</span></>}
                            {profile.plate && <><Dot /><PlateChip plate={profile.plate} /></>}
                        </>
                    }
                    badges={<KycBadge status={profile.kycStatus} />}
                    actions={
                        <>
                            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                                <IconEdit className="size-4" stroke={1.5} />
                                <span className="hidden sm:inline">{t("profile.edit")}</span>
                            </Button>
                            <Button size="sm" onClick={() => onTab("documents")}>
                                <IconFileCheck className="size-4" stroke={1.5} />
                                <span className="hidden sm:inline">{t("profile.review")}</span>
                            </Button>
                            <StandingMenu
                                subjectType="driver"
                                subjectId={profile.id}
                                kycStatus={profile.kycStatus}
                                copy={profile.phoneNumber && !isPlaceholder("phone", profile.phoneNumber) ? [{ label: t("actions.copy-phone"), value: profile.phoneNumber }] : []}
                            />
                        </>
                    }
                />
            }
        >
            {tab === "overview" && <DriverOverview profile={profile} onOrders={() => onTab("orders")} />}
            {tab === "documents" && <DocumentChecklist subjectType="driver" subjectId={profile.id} />}
            {tab === "orders" && <OrdersTab subjectType="driver" subjectId={profile.id} />}
            {tab === "activity" && <ActivityTab subjectType="driver" subjectId={profile.id} />}
            {(tab === "fleet" || tab === "drivers" || tab === "portal") && <DriverOverview profile={profile} onOrders={() => onTab("orders")} />}

            <EditPartnerDialog
                target={{ kind: "driver", id: profile.id, values: editValues }}
                open={editOpen}
                onOpenChange={setEditOpen}
            />
        </Frame>
    )
}

// ---------------------------------------------------------------------------
// Vehicle
// ---------------------------------------------------------------------------

function VehiclePanel({ kind, id, tab, onTab, onClose }: PanelProps & { kind: VehicleKind }) {
    const t = useTranslations("Admin.partners")
    const trpc = useTRPC()
    const query = useQuery(trpc.partners.vehicleProfile.queryOptions({ kind, id }))
    const [editOpen, setEditOpen] = useState(false)

    const profile = query.data

    const editValues = useMemo(() => profile ? {
        regPlate: profile.regPlate,
        internalId: profile.internalId ?? "",
        brand: profile.brand,
        model: profile.model,
        year: String(profile.year),
        vin: profile.vin,
    } : null, [profile])

    if (query.isPending) return <PanelSkeleton />
    if (query.isError || !profile || !editValues) return <PanelError onClose={onClose} />

    const tabs: TabItem[] = [
        { value: "overview", label: t("profile.tabs.overview") },
        { value: "documents", label: t("profile.tabs.documents"), count: `${profile.progress.approved}/${profile.progress.required}` },
        { value: "orders", label: t("profile.tabs.orders"), count: profile.performance.totalOrders },
        { value: "activity", label: t("profile.tabs.activity") },
    ]

    return (
        <Frame
            tabs={tabs}
            tab={tab}
            onTab={onTab}
            header={
                <Header
                    fallback={profile.regPlate.slice(0, 3)}
                    name={profile.regPlate}
                    onClose={onClose}
                    subtitle={
                        <>
                            <span>{t(`fleet.kind.${kind}`)}</span>
                            <Dot />
                            <span>{profile.brand} {profile.model} · {profile.year}</span>
                            {profile.carrierName && <><Dot /><span>{profile.carrierName}</span></>}
                        </>
                    }
                    badges={
                        <>
                            <KycBadge status={profile.kycStatus} />
                            <OwnershipBadge status={profile.ownershipStatus} />
                        </>
                    }
                    actions={
                        <>
                            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                                <IconEdit className="size-4" stroke={1.5} />
                                <span className="hidden sm:inline">{t("profile.edit")}</span>
                            </Button>
                            <Button size="sm" onClick={() => onTab("documents")}>
                                <IconFileCheck className="size-4" stroke={1.5} />
                                <span className="hidden sm:inline">{t("profile.review")}</span>
                            </Button>
                            <StandingMenu
                                subjectType={kind}
                                subjectId={profile.id}
                                kycStatus={profile.kycStatus}
                                copy={[
                                    { label: t("actions.copy-plate"), value: profile.regPlate },
                                    { label: t("actions.copy-vin"), value: profile.vin },
                                ]}
                            />
                        </>
                    }
                />
            }
        >
            {tab === "overview" && <VehicleOverview profile={profile} onOrders={() => onTab("orders")} />}
            {tab === "documents" && <DocumentChecklist subjectType={kind} subjectId={profile.id} />}
            {tab === "orders" && <OrdersTab subjectType={kind} subjectId={profile.id} />}
            {tab === "activity" && <ActivityTab subjectType={kind} subjectId={profile.id} />}
            {(tab === "fleet" || tab === "drivers" || tab === "portal") && <VehicleOverview profile={profile} onOrders={() => onTab("orders")} />}

            <EditPartnerDialog
                target={{ kind: "vehicle", vehicle: kind, id: profile.id, values: editValues }}
                open={editOpen}
                onOpenChange={setEditOpen}
            />
        </Frame>
    )
}
