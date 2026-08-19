import { z } from "zod";

import { useTranslations } from "@workspace/i18n";

type OrganizationTranslator = ReturnType<typeof useTranslations<"Admin.organization">>;

type MessageField = "name" | "nuit" | "email" | "phone" | "billingAddress" | "physicalAddress";

type ErrorParam = { error: string } | undefined;

// Shape stored in the jsonb address columns (see Address in @workspace/db)
const location = (error?: ErrorParam) => z.object({
    address: z.string().nonempty(error),
    placeId: z.string().nonempty(),
    country: z.string().nonempty(),
    state: z.string().nonempty(),
});

function buildSchema(msg: (field: MessageField) => ErrorParam) {
    return z.object({
        name: z.string().nonempty(msg("name")),
        // Mozambican NUITs are 9 digits
        nuit: z.string().regex(/^\d{9}$/, msg("nuit")),
        email: z.email(msg("email")),
        phone: z.string().min(9, msg("phone")),
        billingAddress: location(msg("billingAddress")),
        physicalAddress: location(msg("physicalAddress")),
    });
}

// Message-free variant used by the server action to validate input
export const RegisterOrganizationBaseSchema = buildSchema(() => undefined);

export type RegisterOrganizationForm = z.infer<typeof RegisterOrganizationBaseSchema>;

// Client-side variant with translated error messages
export function RegisterOrganizationSchema(t: OrganizationTranslator) {
    return buildSchema((field) => ({ error: t(`register.fields.${field}.error`) }));
}
