"use client"

import { useQuery } from "@tanstack/react-query"
import type { inferRouterOutputs } from "@trpc/server"
import { IconArrowRight, IconCircleCheck, IconEyeExclamation, IconFileText, IconUpload, IconX } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"
import type { KycDocumentType } from "@workspace/db/types"

import { Spinner } from "@workspace/ui/components/spinner"

import { cn } from "@workspace/ui/lib/utils"

import { Link } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import type { AppRouter } from "@/backend/api/routers/_app"
import { IdentityCell, initials, Mono, PlateChip } from "@workspace/ui/customs/list/table-cells"
import { OrderStatusBadge } from "@/frontend/pages/orders/sections/order-item-shared"
import type { OrderValues } from "@/frontend/pages/orders/types"
import { TripLocation } from "@/frontend/pages/partners/sections/trip-location"
import { AssignDriverPopover, AssignTruckPopover } from "@/frontend/pages/partners/sections/assign-popover"
import { ContractChip, daysUntil, KycBadge, OwnershipBadge, RiskBadge } from "@/frontend/pages/partners/sections/badges"
import { AddressValue, Completeness, CopyButton, DateValue, KeyValue, PhoneValue, ProfileCard, Stat } from "@/frontend/pages/partners/sections/profile-parts"
import { MissingField } from "@/frontend/pages/partners/sections/missing-field"
import { StartChatButton } from "@/frontend/pages/partners/sections/whatsapp-mark"
import { usePartnerMutations } from "@/frontend/pages/partners/hooks/use-partner-mutations"
import { isPlaceholder, type VehicleKind } from "@/frontend/pages/partners/types"
import { today } from "@workspace/domain/kyc/derive"

type Outputs = inferRouterOutputs<AppRouter>

export type OrganizationProfile = Outputs["partners"]["organizationProfile"]
export type DriverProfile = Outputs["partners"]["driverProfile"]
export type VehicleProfile = Outputs["partners"]["vehicleProfile"]
export type SubjectOrder = Outputs["partners"]["subjectOrders"][number]
export type RecentOrder = OrganizationProfile["recentOrders"][number]

const percent = (f: ReturnType<typeof useFormatter>, value: number | null) =>
    value === null ? "—" : f.number(value, { style: "percent", maximumFractionDigits: 0 })

// ---------------------------------------------------------------------------
// Overview: organization
// ---------------------------------------------------------------------------

export function OrganizationOverview({ profile, onOrders }: { profile: OrganizationProfile; onOrders: () => void }) {
    const t = useTranslations("Admin.partners")
    const f = useFormatter()
    const { updateOrganization } = usePartnerMutations()
    const on = today()

    const patch = (field: "nuit" | "email" | "phone") => (value: string) =>
        updateOrganization.mutateAsync({ id: profile.id, patch: { [field]: value } })

    const isCarrier = profile.type === "carrier"
    const expiryDays = profile.nextExpiry ? daysUntil(profile.nextExpiry, on) : null
    const sameAddress = profile.billingAddress && profile.physicalAddress
        && profile.billingAddress.placeId === profile.physicalAddress.placeId

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Completeness
                filled={profile.completeness.filled}
                total={profile.completeness.total}
                missing={profile.completeness.missing}
                labels={{
                    name: t("edit.fields.name"),
                    nuit: t("edit.fields.nuit"),
                    email: t("edit.fields.email"),
                    phone: t("edit.fields.phone"),
                    representee: t("edit.fields.representee"),
                    billingAddress: t("edit.fields.billing-address"),
                    physicalAddress: t("edit.fields.physical-address"),
                }}
                onSave={{
                    nuit: { kind: "nuit", save: patch("nuit") },
                    email: { kind: "email", save: patch("email") },
                    phone: { kind: "phone", save: patch("phone") },
                }}
            />

            <ProfileCard title={t("profile.verification")}>
                <dl className="flex flex-col gap-2">
                    <KeyValue label={t("profile.kyc")}><KycBadge status={profile.kycStatus} /></KeyValue>
                    {isCarrier && (
                        <KeyValue label={t("columns.contract")}>
                            {profile.contract && <ContractChip state={profile.contract} />}
                            {profile.contract === "valid" && profile.contractExpiresAt && (
                                <span className="text-muted-foreground text-xs">{t("profile.until")} <DateValue value={profile.contractExpiresAt} /></span>
                            )}
                        </KeyValue>
                    )}
                    <KeyValue label={t("columns.risk")}>
                        {profile.riskLevel === "none"
                            ? <span className="text-muted-foreground">{t("risk.none")}</span>
                            : <RiskBadge level={profile.riskLevel} reason={profile.riskReason} />}
                    </KeyValue>
                    {profile.riskLevel !== "none" && profile.riskReason && (
                        <p className="text-muted-foreground -mt-1 text-right text-xs">{profile.riskReason}</p>
                    )}
                    <KeyValue label={t("profile.next-expiry")}>
                        {profile.nextExpiry && profile.nextExpiryType ? (
                            <span className={cn(expiryDays !== null && expiryDays <= 30 && "text-[var(--status-expired-text)]", expiryDays !== null && expiryDays < 0 && "text-[var(--status-rejected-text)]")}>
                                {t(`documents.${profile.nextExpiryType as KycDocumentType}`)} · <DateValue value={profile.nextExpiry} />
                            </span>
                        ) : <span className="text-muted-foreground">{t("profile.none")}</span>}
                    </KeyValue>
                    <KeyValue label={t("profile.registered")}><DateValue value={profile.createdAt} /></KeyValue>
                </dl>
            </ProfileCard>

            <ProfileCard title={t("profile.contact")}>
                <dl className="flex flex-col gap-2">
                    <KeyValue label={t("edit.fields.representee")}>
                        {profile.representee ?? <span className="text-muted-foreground">{t("profile.none")}</span>}
                    </KeyValue>
                    <KeyValue label={t("columns.phone")}>
                        {isPlaceholder("phone", profile.phoneNumber)
                            ? <MissingField kind="phone" label={t("missing.add.phone")} onSave={patch("phone")} />
                            : <PhoneValue value={profile.phoneNumber} />}
                    </KeyValue>
                    <KeyValue label={t("edit.fields.email")}>
                        {isPlaceholder("email", profile.email)
                            ? <MissingField kind="email" label={t("missing.add.email")} onSave={patch("email")} />
                            : <><span className="truncate">{profile.email}</span><CopyButton value={profile.email} label={t("actions.copy-email")} /></>}
                    </KeyValue>
                    <KeyValue label={t("edit.fields.billing-address")}><AddressValue address={profile.billingAddress} /></KeyValue>
                    <KeyValue label={t("edit.fields.physical-address")}>
                        {sameAddress ? <span className="text-muted-foreground">{t("profile.same-as-billing")}</span> : <AddressValue address={profile.physicalAddress} />}
                    </KeyValue>
                </dl>
            </ProfileCard>

            <ProfileCard title={t("profile.performance")}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat value={profile.performance.totalOrders} label={t("profile.orders")} />
                    <Stat value={profile.performance.activeOrders} label={t("profile.active-now")} />
                    {isCarrier
                        ? <Stat value={percent(f, profile.performance.onTimeRate)} label={t("columns.on-time")} />
                        : <Stat value={percent(f, profile.performance.settledRate)} label={t("columns.payment")} />}
                    {isCarrier
                        ? <Stat value={profile.fleet.trucks} label={t("profile.trucks-drivers", { drivers: profile.fleet.drivers })} />
                        : <Stat value={percent(f, profile.performance.onTimeRate)} label={t("columns.on-time")} />}
                </div>
                {isCarrier && (
                    <p className="text-muted-foreground text-xs">
                        {t("profile.fleet-line", { trucks: profile.fleet.trucks, trailers: profile.fleet.trailers, links: profile.fleet.links })}
                    </p>
                )}
            </ProfileCard>

            <RecentOrders orders={profile.recentOrders} total={profile.performance.totalOrders} onAll={onOrders} className="lg:col-span-2" />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Overview: driver
// ---------------------------------------------------------------------------

export function DriverOverview({ profile, onOrders }: { profile: DriverProfile; onOrders: () => void }) {
    const t = useTranslations("Admin.partners")
    const f = useFormatter()
    const { updateDriver } = usePartnerMutations()
    const on = today()

    const patch = (field: "phoneNumber" | "passport") => (value: string) =>
        updateDriver.mutateAsync({ id: profile.id, patch: { [field]: value } })

    const expiryDays = profile.nextExpiry ? daysUntil(profile.nextExpiry, on) : null

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Completeness
                filled={profile.completeness.filled}
                total={profile.completeness.total}
                missing={profile.completeness.missing}
                labels={{
                    name: t("edit.fields.name"),
                    phone: t("edit.fields.phone"),
                    email: t("edit.fields.email"),
                    passport: t("edit.fields.passport"),
                    truck: t("columns.truck"),
                }}
                onSave={{
                    phone: { kind: "phone", save: patch("phoneNumber") },
                    passport: { kind: "passport", save: patch("passport") },
                }}
            />

            <ProfileCard title={t("profile.verification")}>
                <dl className="flex flex-col gap-2">
                    <KeyValue label={t("profile.kyc")}><KycBadge status={profile.kycStatus} /></KeyValue>
                    <KeyValue label={t("columns.licence")}>
                        {profile.nextExpiry ? (
                            <span className={cn(expiryDays !== null && expiryDays <= 30 && "text-[var(--status-expired-text)]", expiryDays !== null && expiryDays < 0 && "text-[var(--status-rejected-text)]")}>
                                {t("profile.valid-until")} <DateValue value={profile.nextExpiry} />
                            </span>
                        ) : <span className="text-muted-foreground">{t("values.progress", profile.progress)}</span>}
                    </KeyValue>
                    <KeyValue label={t("profile.registered")}><DateValue value={profile.createdAt} /></KeyValue>
                </dl>
            </ProfileCard>

            <ProfileCard
                title={t("profile.contact")}
                aside={!isPlaceholder("phone", profile.phoneNumber) && profile.whatsapp === "unknown"
                    ? <StartChatButton driverName={profile.name} phone={profile.phoneNumber!} />
                    : undefined}
            >
                <dl className="flex flex-col gap-2">
                    <KeyValue label={t("columns.phone")}>
                        {isPlaceholder("phone", profile.phoneNumber)
                            ? <MissingField kind="phone" label={t("missing.add.phone")} onSave={patch("phoneNumber")} />
                            : <PhoneValue value={profile.phoneNumber!} whatsapp={profile.whatsapp} />}
                    </KeyValue>
                    <KeyValue label={t("edit.fields.email")}>
                        {isPlaceholder("email", profile.email)
                            ? <span className="text-muted-foreground">{t("profile.none")}</span>
                            : <><span className="truncate">{profile.email}</span><CopyButton value={profile.email} label={t("actions.copy-email")} /></>}
                    </KeyValue>
                    <KeyValue label={t("edit.fields.passport")}>
                        {profile.passport
                            ? <Mono>{profile.passport}</Mono>
                            : <MissingField kind="passport" label={t("missing.add.passport")} onSave={patch("passport")} />}
                    </KeyValue>
                    <KeyValue label={t("columns.owner")}>
                        {profile.carrierName ? (
                            <Link href={{ pathname: "/carriers/all", query: { id: profile.carrierId } }} className="hover:text-primary inline-flex items-center gap-1 underline-offset-4 hover:underline">
                                {profile.carrierName}
                                <IconArrowRight className="size-3.5" stroke={1.5} />
                            </Link>
                        ) : <span className="text-muted-foreground">{t("values.none")}</span>}
                    </KeyValue>
                </dl>
            </ProfileCard>

            <ProfileCard
                title={t("profile.assignment")}
                aside={<AssignTruckPopover driverId={profile.id} carrierId={profile.carrierId} currentTruckId={profile.truckId} currentPlate={profile.plate} />}
            >
                <dl className="flex flex-col gap-2">
                    <KeyValue label={t("columns.truck")}>
                        {profile.plate ? (
                            <Link href={{ pathname: "/carriers/fleets", query: { id: profile.truckId ?? "" } }} className="inline-flex items-center gap-2">
                                <PlateChip plate={profile.plate} />
                                <span className="text-muted-foreground text-xs">{[profile.truckBrand, profile.truckModel].filter(Boolean).join(" ")}</span>
                            </Link>
                        ) : <span className="text-muted-foreground">{t("values.unassigned")}</span>}
                    </KeyValue>
                    <KeyValue label={t("columns.location")}><TripLocation trip={profile.trip} /></KeyValue>
                </dl>
            </ProfileCard>

            <ProfileCard title={t("profile.performance")} className="lg:col-span-2">
                <div className="grid grid-cols-3 gap-3">
                    <Stat value={profile.performance.totalOrders} label={t("profile.orders")} />
                    <Stat value={profile.performance.activeOrders} label={t("profile.active-now")} />
                    <Stat value={percent(f, profile.performance.onTimeRate)} label={t("columns.on-time")} />
                </div>
            </ProfileCard>

            <RecentOrders orders={profile.recentOrders} total={profile.performance.totalOrders} onAll={onOrders} className="lg:col-span-2" />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Overview: vehicle
// ---------------------------------------------------------------------------

export function VehicleOverview({ profile, onOrders }: { profile: VehicleProfile; onOrders: () => void }) {
    const t = useTranslations("Admin.partners")
    // The bay type labels already exist for the vehicle registration form; reuse them
    const bays = useTranslations("Admin.fleet.register.fields.bay.type.options")
    const f = useFormatter()

    const bay = profile.loadingBay

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Completeness
                filled={profile.completeness.filled}
                total={profile.completeness.total}
                missing={profile.completeness.missing}
                labels={{
                    brand: t("edit.fields.brand"),
                    model: t("edit.fields.model"),
                    year: t("edit.fields.year"),
                    vin: t("edit.fields.vin"),
                    loadingBay: t("profile.loading-bay"),
                    ownership: t("columns.ownership"),
                }}
            />

            <ProfileCard title={t("profile.verification")}>
                <dl className="flex flex-col gap-2">
                    <KeyValue label={t("profile.kyc")}><KycBadge status={profile.kycStatus} /></KeyValue>
                    <KeyValue label={t("columns.ownership")}><OwnershipBadge status={profile.ownershipStatus} /></KeyValue>
                    {profile.ownerName && (
                        <KeyValue label={t("profile.owner")}>
                            <span className="flex flex-col items-end">
                                <span>{profile.ownerName}</span>
                                {profile.ownerNuit && <Mono className="text-muted-foreground">{profile.ownerNuit}</Mono>}
                            </span>
                        </KeyValue>
                    )}
                    <KeyValue label={t("columns.documents")}><span>{t("values.progress", profile.progress)}</span></KeyValue>
                    <KeyValue label={t("profile.registered")}><DateValue value={profile.createdAt} /></KeyValue>
                </dl>
            </ProfileCard>

            <ProfileCard title={t("profile.details")}>
                <dl className="flex flex-col gap-2">
                    <KeyValue label={t("edit.fields.plate")}><PlateChip plate={profile.regPlate} /></KeyValue>
                    <KeyValue label={t("edit.fields.internal-id")}>
                        {profile.internalId ? <Mono>{profile.internalId}</Mono> : <span className="text-muted-foreground">{t("profile.none")}</span>}
                    </KeyValue>
                    <KeyValue label={t("profile.make")}>{profile.brand} {profile.model} · {profile.year}</KeyValue>
                    <KeyValue label={t("edit.fields.vin")}><Mono>{profile.vin}</Mono><CopyButton value={profile.vin} label={t("actions.copy-vin")} /></KeyValue>
                    {profile.truckType && <KeyValue label={t("profile.vehicle-type")}>{t(`values.truck-type.${profile.truckType}`)}</KeyValue>}
                    <KeyValue label={t("profile.loading-bay")}>
                        {bay ? (
                            <span className="flex flex-col items-end">
                                <span>{bays(bay.type as never)} · {t("values.tons", { tons: f.number(bay.capacity) })}</span>
                                <span className="text-muted-foreground text-xs">{bay.length} × {bay.width} × {bay.height} m · {bay.volume} m³</span>
                            </span>
                        ) : <span className="text-muted-foreground">{profile.truckType === "articulated" ? t("profile.bay-on-trailer") : t("profile.none")}</span>}
                    </KeyValue>
                </dl>
            </ProfileCard>

            <ProfileCard
                title={t("profile.operation")}
                aside={profile.kind === "truck" ? <AssignDriverPopover truckId={profile.id} carrierId={profile.carrierId} /> : undefined}
            >
                <dl className="flex flex-col gap-2">
                    <KeyValue label={t("columns.owner")}>
                        {profile.carrierName ? (
                            <Link href={{ pathname: "/carriers/all", query: { id: profile.carrierId } }} className="hover:text-primary inline-flex items-center gap-1 underline-offset-4 hover:underline">
                                {profile.carrierName}
                                <IconArrowRight className="size-3.5" stroke={1.5} />
                            </Link>
                        ) : <span className="text-muted-foreground">{t("values.none")}</span>}
                    </KeyValue>
                    {profile.kind === "truck" && (
                        <KeyValue label={t("columns.driver")}>
                            {profile.drivers.length === 0
                                ? <span className="text-muted-foreground">{t("values.unassigned")}</span>
                                : (
                                    <span className="flex flex-col items-end gap-1">
                                        {profile.drivers.map((driver) => (
                                            <Link key={driver.id} href={{ pathname: "/carriers/drivers", query: { id: driver.id } }} className="hover:text-primary inline-flex items-center gap-1.5">
                                                {driver.name}
                                                <KycBadge status={driver.kycStatus} />
                                            </Link>
                                        ))}
                                    </span>
                                )}
                        </KeyValue>
                    )}
                    <KeyValue label={t("columns.location")}><TripLocation trip={profile.trip} variant="route" /></KeyValue>
                </dl>
            </ProfileCard>

            <ProfileCard title={t("profile.performance")} className="lg:col-span-2">
                <div className="grid grid-cols-2 gap-3">
                    <Stat value={profile.performance.totalOrders} label={t("profile.orders")} />
                    <Stat value={profile.performance.activeOrders} label={t("profile.active-now")} />
                </div>
            </ProfileCard>

            <RecentOrders orders={profile.recentOrders} total={profile.performance.totalOrders} onAll={onOrders} className="lg:col-span-2" />
        </div>
    )
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function OrderRow({ order, counterparty }: { order: RecentOrder; counterparty?: string | null }) {
    const f = useFormatter()

    return (
        <li className="flex items-center gap-3 border-t py-2.5 text-[13px] first:border-t-0">
            <Link
                href={{ pathname: "/orders/details/[orderId]", params: { orderId: order.orderId } }}
                className="hover:text-primary font-mono text-xs font-medium underline-offset-4 hover:underline"
            >
                {order.orderId}
            </Link>
            <span className="min-w-0 flex-1 truncate">
                {order.from ?? "?"} → {order.to ?? "?"}
                {counterparty && <span className="text-muted-foreground"> · {counterparty}</span>}
            </span>
            <span className="text-muted-foreground hidden text-xs sm:inline">
                {order.date ? f.dateTime(order.date, { day: "2-digit", month: "short" }) : ""}
            </span>
            <OrderStatusBadge status={order.status as OrderValues["status"]} />
        </li>
    )
}

function RecentOrders({ orders, total, onAll, className }: { orders: RecentOrder[]; total: number; onAll: () => void; className?: string }) {
    const t = useTranslations("Admin.partners.profile")

    return (
        <ProfileCard
            title={t("recent-orders")}
            className={className}
            aside={total > orders.length && (
                <button type="button" onClick={onAll} className="hover:text-foreground cursor-pointer">{t("view-all", { count: total })}</button>
            )}
        >
            {orders.length === 0
                ? <p className="text-muted-foreground text-sm">{t("no-orders")}</p>
                : <ul className="flex flex-col">{orders.map((order) => <OrderRow key={order.id} order={order} />)}</ul>}
        </ProfileCard>
    )
}

export function OrdersTab({ subjectType, subjectId }: { subjectType: "shipper" | "carrier" | "driver" | VehicleKind; subjectId: string }) {
    const t = useTranslations("Admin.partners.profile")
    const trpc = useTRPC()
    const query = useQuery(trpc.partners.subjectOrders.queryOptions({ subjectType, subjectId, limit: 50 }))

    if (query.isPending) return <Loading />
    if (query.isError) return <p className="text-destructive text-sm">{t("load-failed")}</p>
    if (query.data.length === 0) return <p className="text-muted-foreground py-8 text-center text-sm">{t("no-orders")}</p>

    return (
        <ul className="flex flex-col">
            {query.data.map((order) => (
                <OrderRow
                    key={order.id}
                    order={order}
                    counterparty={subjectType === "shipper" ? order.carrierName : subjectType === "carrier" ? order.shipperName : order.shipperName}
                />
            ))}
        </ul>
    )
}

export function FleetTab({ organizationId }: { organizationId: string }) {
    const t = useTranslations("Admin.partners")
    const trpc = useTRPC()
    const query = useQuery(trpc.partners.organizationFleet.queryOptions({ id: organizationId }))

    if (query.isPending) return <Loading />
    if (query.isError) return <p className="text-destructive text-sm">{t("profile.load-failed")}</p>

    const groups: { kind: VehicleKind; rows: typeof query.data.trucks }[] = [
        { kind: "truck", rows: query.data.trucks },
        { kind: "trailer", rows: query.data.trailers },
        { kind: "link", rows: query.data.links },
    ]

    if (groups.every((group) => group.rows.length === 0)) {
        return <p className="text-muted-foreground py-8 text-center text-sm">{t("profile.no-fleet")}</p>
    }

    return (
        <div className="flex flex-col gap-5">
            {groups.filter((group) => group.rows.length > 0).map((group) => (
                <section key={group.kind} className="flex flex-col gap-1">
                    <h4 className="text-muted-foreground text-xs font-medium">{t(`fleet.kind.${group.kind}`)} · {group.rows.length}</h4>
                    <ul className="flex flex-col">
                        {group.rows.map((vehicle) => (
                            <li key={vehicle.id}>
                                <Link
                                    href={{ pathname: "/carriers/fleets", query: { kind: group.kind, id: vehicle.id } }}
                                    className="hover:bg-muted/60 -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 text-[13px] transition-colors"
                                >
                                    <PlateChip plate={vehicle.regPlate} />
                                    <span className="min-w-0 flex-1 truncate">{vehicle.brand} {vehicle.model} · {vehicle.year}</span>
                                    <OwnershipBadge status={vehicle.ownershipStatus} />
                                    <KycBadge status={vehicle.kycStatus} />
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    )
}

export function DriversTab({ organizationId }: { organizationId: string }) {
    const t = useTranslations("Admin.partners")
    const trpc = useTRPC()
    const query = useQuery(trpc.partners.organizationFleet.queryOptions({ id: organizationId }))

    if (query.isPending) return <Loading />
    if (query.isError) return <p className="text-destructive text-sm">{t("profile.load-failed")}</p>
    if (query.data.drivers.length === 0) return <p className="text-muted-foreground py-8 text-center text-sm">{t("profile.no-drivers")}</p>

    return (
        <ul className="flex flex-col">
            {query.data.drivers.map((driver) => (
                <li key={driver.id}>
                    <Link
                        href={{ pathname: "/carriers/drivers", query: { id: driver.id } }}
                        className="hover:bg-muted/60 -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 text-[13px] transition-colors"
                    >
                        <span className="min-w-0 flex-1">
                            <IdentityCell size="sm" image={driver.image} fallback={initials(driver.name)} name={driver.name} sub={driver.phoneNumber ?? undefined} />
                        </span>
                        {driver.plate && <PlateChip plate={driver.plate} />}
                        <KycBadge status={driver.kycStatus} />
                    </Link>
                </li>
            ))}
        </ul>
    )
}

type ActivityEvent = { at: Date; kind: "uploaded" | "approved" | "rejected" | "risk"; type?: KycDocumentType; note?: string | null }

export function ActivityTab({
    subjectType,
    subjectId,
    risk,
}: {
    subjectType: "organization" | "driver" | VehicleKind
    subjectId: string
    risk?: { level: string; reason: string | null; at: Date | null }
}) {
    const t = useTranslations("Admin.partners")
    const f = useFormatter()
    const trpc = useTRPC()
    const query = useQuery(trpc.kyc.documents.queryOptions({ subjectType, subjectId }))

    if (query.isPending) return <Loading />
    if (query.isError) return <p className="text-destructive text-sm">{t("profile.load-failed")}</p>

    const events: ActivityEvent[] = []

    for (const doc of query.data.documents) {
        events.push({ at: new Date(doc.createdAt), kind: "uploaded", type: doc.type })
        if (doc.reviewedAt && doc.status !== "pending") {
            events.push({ at: new Date(doc.reviewedAt), kind: doc.status === "approved" ? "approved" : "rejected", type: doc.type, note: doc.rejectionReason })
        }
    }
    if (risk && risk.at && risk.level !== "none") {
        events.push({ at: new Date(risk.at), kind: "risk", note: risk.reason })
    }

    events.sort((a, b) => b.at.getTime() - a.at.getTime())

    if (events.length === 0) return <p className="text-muted-foreground py-8 text-center text-sm">{t("profile.no-activity")}</p>

    const icon = {
        uploaded: <IconUpload className="size-3.5" stroke={1.5} />,
        approved: <IconCircleCheck className="size-3.5" stroke={1.5} />,
        rejected: <IconX className="size-3.5" stroke={1.5} />,
        risk: <IconEyeExclamation className="size-3.5" stroke={1.5} />,
    }

    return (
        <ol className="flex flex-col">
            {events.map((event, index) => (
                <li key={index} className="flex gap-3 py-2.5 text-[13px]">
                    <span className={cn(
                        "bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                        event.kind === "approved" && "bg-[var(--status-verified-bg)] text-[var(--status-verified-text)]",
                        event.kind === "rejected" && "bg-[var(--status-rejected-bg)] text-[var(--status-rejected-text)]",
                        event.kind === "risk" && "bg-[var(--status-expired-bg)] text-[var(--status-expired-text)]",
                    )}>
                        {icon[event.kind]}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span>
                            {event.kind === "risk"
                                ? t("profile.activity.risk")
                                : t(`profile.activity.${event.kind}`, { document: t(`documents.${event.type!}`) })}
                        </span>
                        {event.note && <span className="text-muted-foreground text-xs">{event.note}</span>}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">{f.dateTime(event.at, { dateStyle: "medium" })}</span>
                </li>
            ))}
        </ol>
    )
}

function Loading() {
    return (
        <div className="flex justify-center py-10">
            <Spinner className="text-primary" />
        </div>
    )
}

export const documentIcon = <IconFileText className="size-4" stroke={1.5} />
