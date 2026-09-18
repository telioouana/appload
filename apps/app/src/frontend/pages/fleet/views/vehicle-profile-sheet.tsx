"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconPencil } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { useTRPC } from "@/backend/api/client"
import { Mono, PlateChip } from "@workspace/ui/customs/list/table-cells"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { KycBadge, OwnershipBadge, StateBadge } from "@/frontend/pages/fleet/sections/badges"
import { AssignDriverPopover } from "@/frontend/pages/fleet/sections/assign-driver-popover"
import { EditVehicleDialog } from "@/frontend/pages/fleet/sections/edit-vehicle-dialog"
import { PapersCard } from "@/frontend/pages/fleet/sections/papers-card"
import {
    DateValue,
    KeyValue,
    ProfileBody,
    ProfileCard,
    ProfileHeader,
    ProfileSkeleton,
} from "@/frontend/pages/fleet/sections/profile-parts"
import { useEntitySheet } from "@workspace/ui/hooks/use-entity-sheet"
import { useVerifiedFleet } from "@/frontend/pages/fleet/hooks/use-verified-fleet"
import type { VehicleKind, VehicleProfile } from "@/frontend/pages/fleet/types"

/**
 * The profile panel the vehicles list mounts once. Which vehicle it shows
 * comes from the URL, so a row click and a shared link open the same thing.
 *
 * The booklet and the proof of ownership are filed from here — papers are
 * what a dispatch is checked against — while the verdict on them stays
 * Appload's, so a carrier reads what is still being waited on.
 */
export function VehicleProfileSheet({ kind }: { kind: VehicleKind }) {
    const t = useTranslations("App.fleet.profile")
    const { id, close } = useEntitySheet()

    return (
        <Sheet open={Boolean(id)} onOpenChange={(next) => { if (!next) close() }}>
            <SheetContent
                side="right"
                showCloseButton={false}
                className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-3/5 2xl:data-[side=right]:w-[760px]"
            >
                <SheetHeader className="sr-only">
                    <SheetTitle>{t("title")}</SheetTitle>
                    <SheetDescription>{t("description")}</SheetDescription>
                </SheetHeader>

                {id && <Panel key={id} kind={kind} id={id} onClose={close} />}
            </SheetContent>
        </Sheet>
    )
}

function Panel({ kind, id, onClose }: { kind: VehicleKind; id: string; onClose: () => void }) {
    const t = useTranslations("App.fleet")
    const trpc = useTRPC()
    const verified = useVerifiedFleet()

    const [editing, setEditing] = useState(false)

    const { data, isPending, isError } = useQuery(trpc.fleet.vehicles.get.queryOptions({ kind, id }))

    if (isPending) return <ProfileSkeleton />

    // An id that is not this carrier's own comes back NOT_FOUND, and the query
    // does not throw — without this the sheet would sit on grey bars for ever
    if (isError || !data) return <p className="text-destructive p-6 text-sm">{t("profile.error")}</p>

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="px-5 pt-5 pb-4 md:px-6">
                <ProfileHeader
                    fallback={data.regPlate.slice(0, 2)}
                    name={<span className="flex items-center gap-2"><PlateChip plate={data.regPlate} /></span>}
                    subtitle={`${data.brand} ${data.model} · ${data.year}`}
                    badges={
                        <>
                            {verified && <KycBadge status={data.kycStatus} />}
                            {verified && <OwnershipBadge status={data.ownershipStatus} />}
                            <StateBadge state={data.status} />
                        </>
                    }
                    actions={
                        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                            <IconPencil className="size-4" stroke={1.5} />
                            {t("actions.edit")}
                        </Button>
                    }
                    closeLabel={t("profile.close")}
                    onClose={onClose}
                />
            </div>

            <ProfileBody>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Details profile={data} />
                    {verified && <Verification profile={data} />}
                    <Operation profile={data} verified={verified} />
                    {verified && (
                        <PapersCard
                            subjectType={kind}
                            subjectId={data.id}
                            title={t("profile.documents")}
                            className="lg:col-span-2"
                        />
                    )}
                </div>
            </ProfileBody>

            <EditVehicleDialog
                kind={kind}
                id={data.id}
                open={editing}
                onOpenChange={setEditing}
                values={{
                    regPlate: data.regPlate,
                    internalId: data.internalId ?? "",
                    brand: data.brand,
                    model: data.model,
                    year: String(data.year),
                    vin: data.vin,
                }}
            />
        </div>
    )
}

function Details({ profile }: { profile: VehicleProfile }) {
    const t = useTranslations("App.fleet")
    const bays = useTranslations("App.fleet.register.fields.bay.type.options")
    const f = useFormatter()

    const bay = profile.loadingBay

    return (
        <ProfileCard title={t("profile.details")}>
            <dl className="flex flex-col gap-2">
                <KeyValue label={t("edit.fields.internalId")}>
                    {profile.internalId ? <Mono>{profile.internalId}</Mono> : <EmptyValue label={t("profile.none")} />}
                </KeyValue>
                <KeyValue label={t("profile.make")}>{profile.brand} {profile.model} · {profile.year}</KeyValue>
                <KeyValue label={t("edit.fields.vin")}><Mono>{profile.vin}</Mono></KeyValue>
                {profile.truckType && (
                    <KeyValue label={t("profile.vehicle-type")}>{t(`values.truck-type.${profile.truckType}`)}</KeyValue>
                )}
                <KeyValue label={t("profile.loading-bay")}>
                    {bay ? (
                        <span className="flex flex-col items-end">
                            <span>{bays(bay.type)} · {t("values.tons", { tons: f.number(bay.capacity) })}</span>
                            <span className="text-muted-foreground text-xs">
                                {bay.length} × {bay.width} × {bay.height} m · {bay.volume} m³
                            </span>
                        </span>
                    ) : (
                        <EmptyValue label={profile.truckType === "articulated" ? t("profile.bay-on-trailer") : t("profile.none")} />
                    )}
                </KeyValue>
            </dl>
        </ProfileCard>
    )
}

function Verification({ profile }: { profile: VehicleProfile }) {
    const t = useTranslations("App.fleet")

    return (
        <ProfileCard title={t("profile.verification")}>
            <dl className="flex flex-col gap-2">
                <KeyValue label={t("profile.kyc")}><KycBadge status={profile.kycStatus} /></KeyValue>
                <KeyValue label={t("columns.ownership")}><OwnershipBadge status={profile.ownershipStatus} /></KeyValue>
                {profile.ownerName && (
                    <KeyValue label={t("profile.owner")}>
                        <span className="flex flex-col items-end">
                            <span className="truncate">{profile.ownerName}</span>
                            {profile.ownerNuit && <Mono className="text-muted-foreground">{profile.ownerNuit}</Mono>}
                        </span>
                    </KeyValue>
                )}
                <KeyValue label={t("columns.documents")}>{t("values.progress", profile.progress)}</KeyValue>
                <KeyValue label={t("profile.registered")}>
                    <DateValue value={profile.createdAt} fallback={t("profile.none")} />
                </KeyValue>
            </dl>
        </ProfileCard>
    )
}

function Operation({ profile, verified }: { profile: VehicleProfile; verified: boolean }) {
    const t = useTranslations("App.fleet")

    return (
        <ProfileCard
            title={t("profile.operation")}
            aside={profile.kind === "truck"
                ? <AssignDriverPopover truckId={profile.id} hasDriver={profile.drivers.length > 0} />
                : undefined}
        >
            <dl className="flex flex-col gap-2">
                <KeyValue label={t("columns.state")}><StateBadge state={profile.status} /></KeyValue>

                {profile.kind === "truck" ? (
                    <KeyValue label={t("profile.driver")}>
                        {profile.drivers.length === 0
                            ? <EmptyValue label={t("values.unassigned")} />
                            : (
                                <span className="flex flex-col items-end gap-1">
                                    {profile.drivers.map((driver) => (
                                        <span key={driver.id} className="inline-flex items-center gap-1.5">
                                            <span className="truncate">{driver.name}</span>
                                            {verified && <KycBadge status={driver.kycStatus} />}
                                        </span>
                                    ))}
                                </span>
                            )}
                    </KeyValue>
                ) : (
                    <KeyValue label={t("profile.hitched")}>
                        {profile.hitchedTo
                            ? <PlateChip plate={profile.hitchedTo} />
                            : <EmptyValue label={t("values.not-hitched")} />}
                    </KeyValue>
                )}
            </dl>
        </ProfileCard>
    )
}

