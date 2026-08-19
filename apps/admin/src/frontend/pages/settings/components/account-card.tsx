"use client"

import { z } from "zod"
import { toast } from "sonner"
import { useMemo } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconDeviceFloppy } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { authClient } from "@workspace/auth/client"
import { useEdgeStore } from "@workspace/edgestore/client"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { TextInput } from "@workspace/ui/inputs/text"
import { FileInput } from "@workspace/ui/inputs/file"
import { Spinner } from "@workspace/ui/components/spinner"
import { FieldGroup, FieldSet } from "@workspace/ui/components/field"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { ProfileSchema } from "@/backend/schemas/settings"

// Avatars go through the same staff-only bucket as order documents, under
// an `avatars/<user id>` prefix. Keyed on the id rather than the name so a
// rename does not orphan the file.
const AVATAR_ACCEPT = ["image/jpeg", "image/png"]
const AVATAR_MAX_SIZE = 2 * 1024 * 1024

type SessionUser = typeof authClient.$Infer.Session.user

export function AccountCard({ user }: { user: SessionUser }) {
    const t = useTranslations("Admin.settings")

    const { edgestore } = useEdgeStore()

    const FormSchema = useMemo(() => ProfileSchema(t), [t])
    type TypeSchema = z.infer<typeof FormSchema>

    const { control, handleSubmit, reset, formState: { isSubmitting, isDirty } } = useForm<TypeSchema>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            name: user.name,
            image: user.image ?? undefined,
        },
    })

    // Previewed live from the form rather than the session: the upload
    // finishes before submit, so the session still holds the old URL.
    // `useWatch` rather than `watch` so React Compiler can still memoize
    const image = useWatch({ control, name: "image" })
    const name = useWatch({ control, name: "name" })
    const initials = (name.trim() || user.email)
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()

    async function onSubmit(data: TypeSchema) {
        const { error } = await authClient.updateUser({
            name: data.name,
            image: data.image ?? null,
        })

        if (error) {
            toast(t("account.error"))
            return
        }

        // Two-phase commit, same as the KYC uploads: FileInput lands the
        // avatar as `temporary`, and EdgeStore deletes unconfirmed blobs
        // after 24 hours. Now that the profile points at it, it can stay.
        //
        // `user.image` is still the pre-save value here — the session only
        // refetches once `updateUser` resolves — so this compares the new
        // URL against what the profile pointed at on entry.
        if (data.image && data.image !== user.image) {
            try {
                await edgestore.apploadFiles.confirmUpload({ url: data.image })
            } catch (error) {
                // The profile is already saved; a failed confirm costs the
                // avatar a day from now, not this save
                console.error("edgestore: confirm avatar", error)
            }
        }

        // Re-baselines `isDirty` so the save button settles after a
        // successful write
        reset(data)
        toast(t("account.success"))
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("account.title")}</CardTitle>
                <CardDescription>{t("account.description")}</CardDescription>
            </CardHeader>

            <CardContent>
                <form onSubmit={handleSubmit(onSubmit)}>
                    <FieldGroup>
                        <FieldSet>
                            <FieldGroup>
                                <div className="flex items-center gap-4">
                                    <Avatar size="lg">
                                        <AvatarImage src={image || undefined} alt={name} />
                                        <AvatarFallback>{initials}</AvatarFallback>
                                    </Avatar>

                                    <div className="min-w-0 flex-1">
                                        <FileInput
                                            name="image"
                                            control={control}
                                            isPending={isSubmitting}
                                            accept={AVATAR_ACCEPT}
                                            maxSize={AVATAR_MAX_SIZE}
                                            path={`avatars/${user.id}`}
                                            label={t("account.image.label")}
                                            description={t("account.image.description")}
                                            formatError={t("account.image.format")}
                                            sizeError={t("account.image.size")}
                                        />
                                    </div>
                                </div>

                                <TextInput
                                    name="name"
                                    control={control}
                                    isPending={isSubmitting}
                                    label={t("account.name.label")}
                                    placeholder={t("account.name.placeholder")}
                                />

                                {/* Email and role are shown, never edited here:
                                    changing the address is a verified flow of
                                    its own, and the role is an admin decision */}
                                <div className="grid gap-1">
                                    <span className="text-sm font-medium">{t("account.email.label")}</span>
                                    <span className="text-muted-foreground text-sm">{user.email}</span>
                                </div>

                                <div className="grid gap-1">
                                    <span className="text-sm font-medium">{t("account.role.label")}</span>
                                    <div>
                                        <Badge variant="outline">
                                            {t(`account.role.options.${roleKey(user.role)}`)}
                                        </Badge>
                                    </div>
                                </div>

                                <Button className="justify-self-start" disabled={isSubmitting || !isDirty}>
                                    {t("account.save")}
                                    {isSubmitting ? <Spinner /> : <IconDeviceFloppy />}
                                </Button>
                            </FieldGroup>
                        </FieldSet>
                    </FieldGroup>
                </form>
            </CardContent>
        </Card>
    )
}

// The admin plugin leaves `role` free-form, so anything outside the staff
// vocabulary falls back to the least privileged label rather than
// rendering a missing translation key.
function roleKey(role: string | null | undefined): "admin" | "manager" | "user" {
    return role === "admin" || role === "manager" ? role : "user"
}
