import { z } from "zod";

import { useTranslations } from "@workspace/i18n";

type SettingsTranslator = ReturnType<typeof useTranslations<"App.settings">>;

type ErrorParam = { error: string } | undefined;

/**
 * The signed-in partner's own account. Submitted straight to Better Auth
 * from the client (`authClient.updateUser`), so this is the only client-side
 * validation there is.
 */
export function ProfileSchema(t: SettingsTranslator) {
    return z.object({
        name: z.string().nonempty({ error: t("profile.name.error") }),
        // The avatar is uploaded by FileInput before submit, so the form
        // value is the resulting EdgeStore URL, never the File itself
        image: z.string().optional(),
    });
}

export type ProfileForm = z.infer<ReturnType<typeof ProfileSchema>>;

// What `me.changePassword` forwards to Better Auth. The bounds match Better
// Auth's own defaults; if `emailAndPassword.minPasswordLength` is ever
// configured, this has to move with it or the client message becomes a lie.
const passwordFields = (msg: (field: "current" | "new") => ErrorParam) => ({
    currentPassword: z.string().nonempty(msg("current")),
    newPassword: z.string().min(8, msg("new")).max(128),
    // Signing other sessions out is the safe default after a credential
    // change, but it stays the user's choice
    revokeOtherSessions: z.boolean(),
});

// Message-free variant used by the tRPC procedure to validate input. The
// confirmation field is absent on purpose: retyping the password is a
// client-side check, and the server has nothing to compare it against.
export const ChangePasswordBaseSchema = z.object(passwordFields(() => undefined));

export type ChangePasswordInput = z.infer<typeof ChangePasswordBaseSchema>;

// Client-side variant with translated error messages, plus the confirmation
export function PasswordSchema(t: SettingsTranslator) {
    return z
        .object({
            ...passwordFields((field) => ({ error: t(`password.${field}.error`) })),
            confirmPassword: z.string().nonempty({ error: t("password.confirm.error") }),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
            error: t("password.confirm.mismatch"),
            path: ["confirmPassword"],
        });
}

export type PasswordForm = z.infer<ReturnType<typeof PasswordSchema>>;

/** Inviting a colleague: Better Auth requires the extra `name` field. */
export function InviteMemberSchema(t: SettingsTranslator) {
    return z.object({
        name: z.string().nonempty({ error: t("invite.fields.name.error") }),
        email: z.email({ error: t("invite.fields.email.error") }),
        role: z.enum(["admin", "member"], { error: t("invite.fields.role.error") }),
    });
}

export type InviteMemberForm = z.infer<ReturnType<typeof InviteMemberSchema>>;
