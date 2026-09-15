"use client"

import { toast } from "sonner";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconDeviceFloppy } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useFormatter, useTranslations } from "@workspace/i18n";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmailInput } from "@workspace/ui/inputs/email";
import { TextInput } from "@workspace/ui/inputs/text";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { LocationInput } from "@workspace/ui/inputs/location";
import { FieldGroup, FieldSet } from "@workspace/ui/components/field";
import { StatusBadge, type StatusKey } from "@workspace/ui/customs/badge/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { useTRPC } from "@/backend/api/client";
import { domainErrorCode } from "@workspace/trpc/errors";
import { UpdateCompanySchema, type UpdateCompanyForm } from "@/backend/schemas/company";
import { ContractUploadDialog } from "@/frontend/pages/settings/components/contract-upload-dialog";
import type { ContractState, MeSession } from "@/frontend/pages/settings/server/procedures";

const ERROR_CODES = ["DUPLICATE_EMAIL", "DUPLICATE_PHONE", "NOT_ALLOWED", "NOT_FOUND", "UNKNOWN"] as const

const EMPTY_LOCATION = { address: "", placeId: "", country: "", state: "" }

const KYC_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    verified: "default",
    rejected: "destructive",
    suspended: "destructive",
    expired: "destructive",
}

/**
 * The company's contact block. Name and NUIT are rows, not fields: they are
 * what Appload's registry and every issued document are keyed on, so
 * correcting either is a staff edit in Admin.
 *
 * Members see the same card read-only — the mutation is owner/admin either
 * way, and hiding the details from the people who work with them helps
 * nobody.
 */
export function CompanyCard({
    organization,
    canEdit,
}: {
    organization: MeSession["organization"]
    canEdit: boolean
}) {
    const t = useTranslations("App.settings")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const update = useMutation(trpc.me.updateCompany.mutationOptions())

    const FormSchema = useMemo(() => UpdateCompanySchema(t), [t])

    const { control, handleSubmit, reset, setError, setValue, formState: { isSubmitting, isDirty } } = useForm<UpdateCompanyForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            email: organization.email,
            phoneNumber: organization.phoneNumber,
            billingAddress: organization.billingAddress ?? { ...EMPTY_LOCATION },
            physicalAddress: organization.physicalAddress ?? { ...EMPTY_LOCATION },
        },
    })

    const isPending = isSubmitting || !canEdit

    async function onSubmit(data: UpdateCompanyForm) {
        try {
            await update.mutateAsync(data)
        } catch (error) {
            const code = domainErrorCode(error, ERROR_CODES, "UNKNOWN")

            // The two conflicts belong on the field that caused them; the
            // rest are not about any one field
            if (code === "DUPLICATE_EMAIL") {
                setError("email", { message: t("company.errors.DUPLICATE_EMAIL") })
                return
            }
            if (code === "DUPLICATE_PHONE") {
                setError("phoneNumber", { message: t("company.errors.DUPLICATE_PHONE") })
                return
            }

            toast.error(t(`company.errors.${code}`))
            return
        }

        void queryClient.invalidateQueries(trpc.me.session.queryFilter())

        reset(data)
        toast.success(t("company.success"))
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("company.title")}</CardTitle>
                <CardDescription>{t("company.description")}</CardDescription>
            </CardHeader>

            <CardContent className="grid gap-6">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-1">
                        <span className="text-sm font-medium">{t("company.readonly.name")}</span>
                        <span className="text-muted-foreground text-sm">{organization.name}</span>
                    </div>

                    <div className="grid gap-1">
                        <span className="text-sm font-medium">{t("company.readonly.nuit")}</span>
                        <span className="text-muted-foreground font-mono text-sm">{organization.nuit}</span>
                    </div>

                    <div className="grid gap-1">
                        <span className="text-sm font-medium">{t("company.readonly.type")}</span>
                        <div>
                            <Badge variant="outline">{t(`company.type.${organization.type}`)}</Badge>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-start gap-6">
                        <div className="grid gap-1">
                            <span className="text-sm font-medium">{t("company.readonly.status")}</span>
                            <div>
                                <Badge variant={organization.status === "active" ? "default" : "secondary"}>
                                    {t(`company.status.${organization.status}`)}
                                </Badge>
                            </div>
                        </div>

                        <div className="grid gap-1">
                            <span className="text-sm font-medium">{t("company.readonly.kyc")}</span>
                            <div>
                                <Badge variant={KYC_TONE[organization.kycStatus] ?? "secondary"}>
                                    {t(`company.kyc.${kycKey(organization.kycStatus)}`)}
                                </Badge>
                            </div>
                        </div>
                    </div>

                    {/* Only transporters sign one (packages/domain kyc
                        requirements), so a shipper is not shown a paper it
                        was never asked for */}
                    {organization.type === "carrier" && (
                        <ContractRow organizationId={organization.id} canEdit={canEdit} />
                    )}
                </div>

                <p className="text-muted-foreground text-xs">{t("company.readonly.hint")}</p>

                <form onSubmit={handleSubmit(onSubmit)}>
                    <FieldGroup>
                        <FieldSet>
                            <FieldGroup>
                                <EmailInput
                                    name="email"
                                    control={control}
                                    isPending={isPending}
                                    label={t("company.fields.email.label")}
                                    placeholder={t("company.fields.email.placeholder")}
                                    description={t("company.fields.email.description")}
                                />

                                <TextInput
                                    name="phoneNumber"
                                    control={control}
                                    isPending={isPending}
                                    label={t("company.fields.phone.label")}
                                    placeholder={t("company.fields.phone.placeholder")}
                                />

                                <LocationInput
                                    name="billingAddress.address"
                                    control={control}
                                    isPending={isPending}
                                    label={t("company.fields.billingAddress.label")}
                                    placeholder={t("company.fields.billingAddress.placeholder")}
                                    setPlaceId={(value) => setValue("billingAddress.placeId", value, { shouldDirty: true })}
                                    setCountry={(value) => setValue("billingAddress.country", value, { shouldDirty: true })}
                                    setState={(value) => setValue("billingAddress.state", value, { shouldDirty: true })}
                                />

                                <LocationInput
                                    name="physicalAddress.address"
                                    control={control}
                                    isPending={isPending}
                                    label={t("company.fields.physicalAddress.label")}
                                    placeholder={t("company.fields.physicalAddress.placeholder")}
                                    setPlaceId={(value) => setValue("physicalAddress.placeId", value, { shouldDirty: true })}
                                    setCountry={(value) => setValue("physicalAddress.country", value, { shouldDirty: true })}
                                    setState={(value) => setValue("physicalAddress.state", value, { shouldDirty: true })}
                                />

                                {canEdit ? (
                                    <Button className="justify-self-start" disabled={isSubmitting || !isDirty}>
                                        {t("company.save")}
                                        {isSubmitting ? <Spinner /> : <IconDeviceFloppy />}
                                    </Button>
                                ) : (
                                    <p className="text-muted-foreground text-xs">{t("company.read-only")}</p>
                                )}
                            </FieldGroup>
                        </FieldSet>
                    </FieldGroup>
                </form>
            </CardContent>
        </Card>
    )
}

// The contract has no status vocabulary of its own — it is one KYC document —
// so each state borrows the tone of the verification state it amounts to
const CONTRACT_TONE: Record<ContractState, StatusKey> = {
    valid: "verified",
    pending: "pending-review",
    missing: "rejected",
    expired: "expired",
    rejected: "rejected",
}

/**
 * The signed contract with Appload: where it stands, and the way to file a
 * new one. Its own query rather than a field on the session — staff approve
 * or reject it in Admin while the partner is signed in, and the upload
 * refetches exactly this.
 */
function ContractRow({ organizationId, canEdit }: { organizationId: string; canEdit: boolean }) {
    const t = useTranslations("App.settings.company.contract")
    const f = useFormatter()
    const trpc = useTRPC()

    const { data } = useQuery(trpc.me.contract.queryOptions())

    return (
        <div className="grid gap-1">
            <span className="text-sm font-medium">{t("title")}</span>

            <div className="flex flex-wrap items-center gap-2">
                {data
                    ? <StatusBadge label={t(`states.${data.status}`)} status={CONTRACT_TONE[data.status]} />
                    : <Skeleton className="h-7 w-24 rounded-full" />}

                {data?.status === "valid" && data.expiresAt && (
                    <span className="text-muted-foreground text-sm">
                        {t("valid-until", { date: f.dateTime(new Date(`${data.expiresAt}T00:00:00`), { dateStyle: "medium" }) })}
                    </span>
                )}

                {canEdit && <ContractUploadDialog organizationId={organizationId} />}
            </div>

            <p className="text-muted-foreground text-xs">{t("hint")}</p>
        </div>
    )
}

// The column is a text vocabulary shared with Admin's KYC pipeline; anything
// outside it falls back to the neutral label rather than a missing key
function kycKey(status: string) {
    return status === "pending-review" || status === "verified" || status === "rejected" ||
        status === "expired" || status === "suspended"
        ? status
        : "draft"
}
