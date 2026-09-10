"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconPencil } from "@tabler/icons-react"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { useTRPC } from "@/backend/api/client"
import { initials, Mono, PlateChip } from "@workspace/ui/customs/list/table-cells"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { KycBadge, StateBadge } from "@/frontend/pages/fleet/sections/badges"
import {
    DateValue,
    KeyValue,
    ProfileBody,
    ProfileCard,
    ProfileHeader,
    ProfileSkeleton,
} from "@/frontend/pages/fleet/sections/profile-parts"
import { EditDriverDialog } from "@/frontend/pages/drivers/sections/edit-driver-dialog"
import { AssignTruckPopover } from "@/frontend/pages/drivers/sections/assign-truck-popover"
import { useDriverSheet } from "@/frontend/pages/drivers/hooks/use-driver-sheet"
import { isPlaceholderEmail, type DriverProfile } from "@/frontend/pages/drivers/types"

/**
 * The profile panel the drivers list mounts once, keyed by `?id=`.
 *
 * The licence and ID card are shown read-only: uploads and review stay in
 * Admin (plan §5), so what the carrier can do here is see what is missing and
 * fix the contact details behind it.
 */
export function DriverProfileSheet() {
    const t = useTranslations("App.drivers.profile")
    const { id, close } = useDriverSheet()

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

                {id && <Panel key={id} id={id} onClose={close} />}
            </SheetContent>
        </Sheet>
    )
}

function Panel({ id, onClose }: { id: string; onClose: () => void }) {
    const t = useTranslations("App.drivers")
    const trpc = useTRPC()

    const [editing, setEditing] = useState(false)

    const { data, isPending, isError } = useQuery(trpc.drivers.get.queryOptions({ id }))

    if (isPending) return <ProfileSkeleton />

    // An id that is not this carrier's own comes back NOT_FOUND, and the query
    // does not throw — without this the sheet would sit on grey bars for ever
    if (isError || !data) return <p className="text-destructive p-6 text-sm">{t("profile.error")}</p>

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="px-5 pt-5 pb-4 md:px-6">
                <ProfileHeader
                    image={data.image}
                    fallback={initials(data.name)}
                    name={data.name}
                    subtitle={data.passport ? t("values.passport", { number: data.passport }) : undefined}
                    badges={
                        <>
                            <KycBadge status={data.kycStatus} />
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
                    <Contact profile={data} />
                    <Verification profile={data} />
                    <Assignment profile={data} />
                    <Documents profile={data} />
                </div>
            </ProfileBody>

            <EditDriverDialog driver={data} open={editing} onOpenChange={setEditing} />
        </div>
    )
}

function Contact({ profile }: { profile: DriverProfile }) {
    const t = useTranslations("App.drivers")

    return (
        <ProfileCard title={t("profile.contact")}>
            <dl className="flex flex-col gap-2">
                <KeyValue label={t("columns.phone")}>
                    {profile.phoneNumber
                        ? <Mono>{profile.phoneNumber}</Mono>
                        : <EmptyValue label={t("values.none")} />}
                </KeyValue>
                <KeyValue label={t("columns.email")}>
                    {isPlaceholderEmail(profile.email)
                        ? <EmptyValue label={t("values.no-email")} />
                        : <span className="truncate">{profile.email}</span>}
                </KeyValue>
                <KeyValue label={t("columns.passport")}>
                    {profile.passport
                        ? <Mono>{profile.passport}</Mono>
                        : <EmptyValue label={t("values.none")} />}
                </KeyValue>
            </dl>
        </ProfileCard>
    )
}

function Verification({ profile }: { profile: DriverProfile }) {
    const t = useTranslations("App.drivers")

    return (
        <ProfileCard title={t("profile.verification")}>
            <dl className="flex flex-col gap-2">
                <KeyValue label={t("profile.kyc")}><KycBadge status={profile.kycStatus} /></KeyValue>
                <KeyValue label={t("columns.documents")}>{t("values.progress", profile.progress)}</KeyValue>
                <KeyValue label={t("profile.registered")}>
                    <DateValue value={profile.createdAt} fallback={t("profile.none")} />
                </KeyValue>
            </dl>
        </ProfileCard>
    )
}

function Assignment({ profile }: { profile: DriverProfile }) {
    const t = useTranslations("App.drivers")

    return (
        <ProfileCard
            title={t("profile.assignment")}
            aside={<AssignTruckPopover driverId={profile.id} currentTruckId={profile.truckId} />}
        >
            <dl className="flex flex-col gap-2">
                <KeyValue label={t("columns.state")}><StateBadge state={profile.status} /></KeyValue>
                <KeyValue label={t("columns.truck")}>
                    {profile.truck ? (
                        <span className="inline-flex items-center gap-2">
                            <PlateChip plate={profile.truck.regPlate} />
                            <span className="text-muted-foreground text-xs">
                                {[profile.truck.brand, profile.truck.model].filter(Boolean).join(" ")}
                            </span>
                        </span>
                    ) : <EmptyValue label={t("values.unassigned")} />}
                </KeyValue>
            </dl>
        </ProfileCard>
    )
}

function Documents({ profile }: { profile: DriverProfile }) {
    const t = useTranslations("App.drivers.profile")
    const types = useTranslations("App.drivers.profile.doc-type")
    const f = useFormatter()

    return (
        <ProfileCard title={t("documents")} className="lg:col-span-2">
            {profile.documents.length === 0 ? (
                <p className="text-muted-foreground text-[13px]">{t("no-documents")}</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {profile.documents.map((doc) => (
                        <li key={doc.type} className="flex items-center justify-between gap-3 text-[13px]">
                            <span className="truncate">
                                {doc.type === "driver-license" || doc.type === "id-card" ? types(doc.type) : doc.type}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                                <span className="text-muted-foreground text-xs">
                                    {doc.expiresAt
                                        ? t("expires", { date: f.dateTime(new Date(`${doc.expiresAt}T00:00:00`), { dateStyle: "medium" }) })
                                        : t("no-expiry")}
                                </span>
                                <Badge variant={doc.status === "approved" ? "default" : doc.status === "rejected" ? "destructive" : "secondary"}>
                                    {t(`doc-status.${doc.status}`)}
                                </Badge>
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            <p className="text-muted-foreground text-xs">{t("read-only")}</p>
        </ProfileCard>
    )
}
