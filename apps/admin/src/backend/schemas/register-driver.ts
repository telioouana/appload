import { z } from "zod";

import { useTranslations } from "@workspace/i18n";

type DriverTranslator = ReturnType<typeof useTranslations<"Admin.driver">>;

type MessageField = "name" | "email" | "phone";

type ErrorParam = { error: string } | undefined;

/**
 * A driver is a user account (the driver row references it), so
 * registration collects the account identity. The phone is stored in E.164
 * so selecting the driver can fill the order form's contact field, which
 * validates the same format.
 */
function buildSchema(msg: (field: MessageField) => ErrorParam) {
    return z.object({
        name: z.string().nonempty(msg("name")),
        email: z.email(msg("email")),
        phoneNumber: z.e164(msg("phone")),
        passport: z.string().optional(),
    });
}

// Message-free variant used by the tRPC procedure to validate input
export const RegisterDriverBaseSchema = buildSchema(() => undefined);

export type RegisterDriverForm = z.infer<typeof RegisterDriverBaseSchema>;

// Client-side variant with translated error messages
export function RegisterDriverSchema(t: DriverTranslator) {
    return buildSchema((field) => ({ error: t(`register.errors.validation.${field}`) }));
}
