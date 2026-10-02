import { z } from "zod";

import { useTranslations } from "@workspace/i18n";
import { toE164 } from "@workspace/ui/lib/phone";

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

/**
 * The client-side shape. `PhoneInput` renders the dial code beside the field
 * and never folds it into the value, so the country travels as a sibling
 * field and `toE164` composes the two at submit — which is also what the
 * refinement validates and what the mutation is handed.
 */
export function RegisterDriverSchema(t: DriverTranslator) {
    const msg = (field: MessageField) => ({ error: t(`register.errors.validation.${field}`) });

    return buildSchema(msg)
        .extend({ country: z.string().nonempty(), phoneNumber: z.string().nonempty(msg("phone")) })
        .refine((data) => z.e164().safeParse(toE164(data.country, data.phoneNumber)).success, {
            ...msg("phone"),
            path: ["phoneNumber"],
        });
}

export type RegisterDriverForm = z.infer<ReturnType<typeof RegisterDriverSchema>>;
