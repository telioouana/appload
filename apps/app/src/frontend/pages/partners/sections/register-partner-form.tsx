"use client"

import { toast } from "sonner"
import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useMutation, useQuery } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconArrowLeft, IconBuildingPlus, IconSend } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import type { ConnectionRelation } from "@workspace/db/connections"

import { Button } from "@workspace/ui/components/button"
import { TextInput } from "@workspace/ui/inputs/text"
import { Spinner } from "@workspace/ui/components/spinner"
import { LocationInput } from "@workspace/ui/inputs/location"
import { FieldGroup } from "@workspace/ui/components/field"
import { DialogFooter } from "@workspace/ui/components/dialog"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import { useTRPC } from "@/backend/api/client"
import { NUIT_RE, RegisterPartnerSchema, type RegisterPartnerForm as RegisterPartnerValues } from "@/backend/schemas/partner"
import { KycBadge } from "@/frontend/pages/partners/sections/badges"
import {
    partnerErrorCode,
    PARTNER_ERROR_KEYS,
    usePartnerMutations,
    type PartnerErrorCode,
} from "@/frontend/pages/partners/hooks/use-partner-mutations"
import { counterpartType, partnerKind, type OrgType } from "@/frontend/pages/partners/types"

const EMPTY_LOCATION = { address: "", placeId: "", country: "", state: "" }

/**
 * Registers a company that is genuinely not in the database yet, and
 * connects to it in the same breath — there is nobody to ask, since the
 * company has no portal account. Staff see it as `pending` in Admin with
 * the registering tenant recorded in its metadata.
 *
 * A duplicate NUIT is not a dead end: the company exists, so the form turns
 * into the request it should have been, with the row the tax number found.
 */
export function RegisterPartnerForm({
    relation,
    orgType,
    onBack,
    onDone,
}: {
    relation: ConnectionRelation
    orgType: OrgType
    onBack: () => void
    onDone: () => void
}) {
    const t = useTranslations("App.partners")
    const trpc = useTRPC()

    const { request, refresh } = usePartnerMutations()

    const [error, setError] = useState<PartnerErrorCode | null>(null)
    // The NUIT that came back as a duplicate, looked up so it can be asked
    const [existingNuit, setExistingNuit] = useState<string | null>(null)

    const register = useMutation(trpc.partners.register.mutationOptions())

    const { data: existing } = useQuery({
        ...trpc.partners.lookupNuit.queryOptions({ nuit: existingNuit ?? "" }),
        enabled: existingNuit !== null && NUIT_RE.test(existingNuit),
    })

    const FormSchema = useMemo(() => RegisterPartnerSchema(t), [t])

    const form = useForm<RegisterPartnerValues>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            relation,
            name: "",
            nuit: "",
            phone: "",
            email: "",
            physicalAddress: { ...EMPTY_LOCATION },
        },
    })

    const isPending = register.isPending || request.isPending

    function onSubmit(values: RegisterPartnerValues) {
        setError(null)
        setExistingNuit(null)

        // The relation lives in the dialog above this form, so what the
        // pills say at submit time is what the partner is registered as
        register.mutate({ ...values, relation }, {
            onSuccess: (created) => {
                void refresh()
                toast.success(t("toasts.registered", { name: created.name }))
                onDone()
            },
            onError: (failure) => {
                const code = partnerErrorCode(failure)

                setError(code)
                if (code === "DUPLICATE_NUIT") setExistingNuit(values.nuit)
            },
        })
    }

    return (
        <>
            <div className="container-snap flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
                {error && (
                    <Alert variant="destructive">
                        <AlertTitle>{t(`errors.${PARTNER_ERROR_KEYS[error]}`)}</AlertTitle>
                        {error === "DUPLICATE_NUIT" && (
                            <AlertDescription>{t("register.duplicate-nuit-hint")}</AlertDescription>
                        )}
                    </Alert>
                )}

                {existing && (
                    <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
                        <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">{existing.name}</span>
                            <span className="text-muted-foreground truncate text-xs">
                                {existing.province ?? t("values.no-province")}
                            </span>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                            <KycBadge status={existing.kycStatus} />

                            {/* The NUIT can find a company of the wrong type
                                for what is being added — a request on it would
                                only come back refused */}
                            {existing.type !== counterpartType(orgType, relation) ? (
                                <span className="text-muted-foreground text-xs">{t("errors.wrongPartnerType")}</span>
                            ) : (
                                <Button
                                    size="sm"
                                    disabled={isPending || existing.connection !== null}
                                    onClick={() => request.mutate(
                                        { organizationId: existing.id, relation },
                                        { onSuccess: onDone },
                                    )}
                                >
                                    <IconSend stroke={1.5} />
                                    {t(existing.connection ? "add.state.pending" : "add.send")}
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                <form id="register-partner-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        <TextInput
                            name="name"
                            control={form.control}
                            isPending={isPending}
                            label={t(`register.fields.name.${partnerKind(orgType, relation)}`)}
                            placeholder={t("register.fields.name.placeholder")}
                        />
                        <TextInput
                            name="nuit"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.nuit.label")}
                            placeholder={t("register.fields.nuit.placeholder")}
                        />
                        <TextInput
                            name="phone"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.phone.label")}
                            placeholder={t("register.fields.phone.placeholder")}
                        />
                        <TextInput
                            name="email"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.email.label")}
                            placeholder={t("register.fields.email.placeholder")}
                            description={t("register.fields.email.description")}
                        />
                        <LocationInput
                            name="physicalAddress.address"
                            control={form.control}
                            isPending={isPending}
                            label={t("register.fields.physicalAddress.label")}
                            placeholder={t("register.fields.physicalAddress.placeholder")}
                            setPlaceId={(value) => form.setValue("physicalAddress.placeId", value, { shouldDirty: true })}
                            setCountry={(value) => form.setValue("physicalAddress.country", value, { shouldDirty: true })}
                            setState={(value) => form.setValue("physicalAddress.state", value, { shouldDirty: true })}
                        />
                    </FieldGroup>
                </form>
            </div>

            <DialogFooter>
                <Button type="button" variant="outline" disabled={isPending} onClick={onBack}>
                    <IconArrowLeft stroke={1.5} />
                    {t("add.back")}
                </Button>
                <Button type="submit" form="register-partner-form" disabled={isPending}>
                    {isPending ? <Spinner className="size-4" /> : <IconBuildingPlus stroke={1.5} />}
                    {t("register.submit")}
                </Button>
            </DialogFooter>
        </>
    )
}
