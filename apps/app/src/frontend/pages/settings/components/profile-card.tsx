"use client"

import { z } from "zod";
import { toast } from "sonner";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconDeviceFloppy } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { authClient } from "@workspace/auth/client";
import { useEdgeStore } from "@workspace/edgestore/client";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { TextInput } from "@workspace/ui/inputs/text";
import { FileInput } from "@workspace/ui/inputs/file";
import { Spinner } from "@workspace/ui/components/spinner";
import { FieldGroup, FieldSet } from "@workspace/ui/components/field";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { useTRPC } from "@/backend/api/client";
import { ProfileSchema } from "@/backend/schemas/settings";
import type { MeSession } from "@/frontend/pages/settings/server/procedures";

// Avatars go through the order-document bucket under an `avatars/<user id>`
// prefix. Keyed on the id rather than the name so a rename does not orphan
// the file.
const AVATAR_ACCEPT = ["image/jpeg", "image/png"]
const AVATAR_MAX_SIZE = 2 * 1024 * 1024

/**
 * The signed-in person's own name and picture. Written straight to Better
 * Auth (`updateUser`) — there is no tenant data here, so no procedure of our
 * own stands between the form and the account.
 */
export function ProfileCard({ user, role }: { user: MeSession["user"]; role: MeSession["role"] }) {
    const t = useTranslations("App.settings")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

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
            toast.error(t("profile.error"))
            return
        }

        // Two-phase commit: FileInput lands the avatar as `temporary`, and
        // EdgeStore deletes unconfirmed blobs after 24 hours. Now that the
        // profile points at it, it can stay.
        //
        // `user.image` is still the pre-save value here, so this compares the
        // new URL against what the profile pointed at on entry.
        if (data.image && data.image !== user.image) {
            try {
                await edgestore.apploadFiles.confirmUpload({ url: data.image })
            } catch (error) {
                // The profile is already saved; a failed confirm costs the
                // avatar a day from now, not this save
                console.error("edgestore: confirm avatar", error)
            }
        }

        // The page reads the account through `me.session`, and the sidebar
        // through the auth session — Better Auth refreshes its own
        void queryClient.invalidateQueries(trpc.me.session.queryFilter())

        // Re-baselines `isDirty` so the save button settles after a
        // successful write
        reset(data)
        toast.success(t("profile.success"))
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("profile.title")}</CardTitle>
                <CardDescription>{t("profile.description")}</CardDescription>
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
                                            label={t("profile.image.label")}
                                            description={t("profile.image.description")}
                                            formatError={t("profile.image.format")}
                                            sizeError={t("profile.image.size")}
                                        />
                                    </div>
                                </div>

                                <TextInput
                                    name="name"
                                    control={control}
                                    isPending={isSubmitting}
                                    label={t("profile.name.label")}
                                    placeholder={t("profile.name.placeholder")}
                                />

                                {/* Email and role are shown, never edited here:
                                    the address is what signs in and what the
                                    invitation was sent to, and the role is the
                                    company's own decision */}
                                <div className="grid gap-1">
                                    <span className="text-sm font-medium">{t("profile.email.label")}</span>
                                    <span className="text-muted-foreground text-sm">{user.email}</span>
                                    <span className="text-muted-foreground text-xs">{t("profile.email.description")}</span>
                                </div>

                                <div className="grid gap-1">
                                    <span className="text-sm font-medium">{t("profile.role.label")}</span>
                                    <div>
                                        <Badge variant="outline">{t(`profile.role.options.${role}`)}</Badge>
                                    </div>
                                </div>

                                <Button className="justify-self-start" disabled={isSubmitting || !isDirty}>
                                    {t("profile.save")}
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
