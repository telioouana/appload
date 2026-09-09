"use client"

import { toast } from "sonner";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconSend, IconUserPlus } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { authClient } from "@workspace/auth/client";

import { Button } from "@workspace/ui/components/button";
import { TextInput } from "@workspace/ui/inputs/text";
import { EmailInput } from "@workspace/ui/inputs/email";
import { SelectInput } from "@workspace/ui/inputs/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { SelectItem } from "@workspace/ui/components/select";
import { FieldGroup } from "@workspace/ui/components/field";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@workspace/ui/components/dialog";

import { InviteMemberSchema, type InviteMemberForm } from "@/backend/schemas/settings";
import { invitationsKey } from "@/frontend/pages/settings/hooks/use-organization";

// Better Auth's own codes, narrowed to the two an inviter can act on
const ERROR_MESSAGE_KEYS: Record<string, "alreadyMember" | "alreadyInvited" | "notAllowed"> = {
    USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: "alreadyMember",
    USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: "alreadyInvited",
    YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: "notAllowed",
    YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: "notAllowed",
}

/**
 * Invites a colleague by email. `name` is a required extra field on the
 * invitation row (packages/auth), so it is asked for here rather than left
 * to whatever the invitee types at sign-up.
 *
 * The owner role is deliberately not offered: it is granted by promoting an
 * existing member, which keeps a company from ending up with two people who
 * each think they are the account holder.
 */
export function InviteMemberDialog({
    organizationId,
    organizationName,
}: {
    organizationId: string
    organizationName: string
}) {
    const t = useTranslations("App.settings")
    const queryClient = useQueryClient()

    const [open, setOpen] = useState(false)
    const [error, setError] = useState<"alreadyMember" | "alreadyInvited" | "notAllowed" | "unknown" | null>(null)

    const FormSchema = useMemo(() => InviteMemberSchema(t), [t])

    const { control, handleSubmit, reset, formState: { isSubmitting } } = useForm<InviteMemberForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: {
            name: "",
            email: "",
            role: "member",
        },
    })

    async function onSubmit(data: InviteMemberForm) {
        setError(null)

        const { error: failure } = await authClient.organization.inviteMember({
            email: data.email,
            role: data.role,
            organizationId,
            name: data.name,
        })

        if (failure) {
            setError(ERROR_MESSAGE_KEYS[failure.code ?? ""] ?? "unknown")
            return
        }

        await queryClient.invalidateQueries({ queryKey: invitationsKey(organizationId) })

        reset()
        setOpen(false)
        toast.success(t("invite.success", { email: data.email }))
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (isSubmitting) return
                setOpen(next)
                if (!next) {
                    reset()
                    setError(null)
                }
            }}
        >
            <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                    <IconUserPlus />
                    {t("invite.button")}
                </Button>
            </DialogTrigger>

            <DialogContent className="w-full sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("invite.title")}</DialogTitle>
                    <DialogDescription>
                        {t("invite.description", { organization: organizationName })}
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <Alert variant="destructive">
                        <AlertTitle>{t(`invite.errors.${error}`)}</AlertTitle>
                    </Alert>
                )}

                <form id="invite-member-form" onSubmit={handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        <TextInput
                            name="name"
                            control={control}
                            isPending={isSubmitting}
                            label={t("invite.fields.name.label")}
                            placeholder={t("invite.fields.name.placeholder")}
                        />

                        <EmailInput
                            name="email"
                            control={control}
                            isPending={isSubmitting}
                            label={t("invite.fields.email.label")}
                            placeholder={t("invite.fields.email.placeholder")}
                        />

                        <SelectInput
                            name="role"
                            control={control}
                            isPending={isSubmitting}
                            label={t("invite.fields.role.label")}
                            placeholder={t("invite.fields.role.placeholder")}
                        >
                            <SelectItem value="admin">{t("invite.roles.admin")}</SelectItem>
                            <SelectItem value="member">{t("invite.roles.member")}</SelectItem>
                        </SelectInput>
                    </FieldGroup>
                </form>

                <DialogFooter className="gap-2">
                    <Button type="submit" form="invite-member-form" disabled={isSubmitting}>
                        {isSubmitting ? <Spinner /> : <IconSend />}
                        {isSubmitting ? t("invite.submitting") : t("invite.submit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
