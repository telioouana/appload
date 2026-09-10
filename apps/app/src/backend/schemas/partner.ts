import { z } from "zod";

import type { useTranslations } from "@workspace/i18n";
import type { ConnectionRelation } from "@workspace/db/connections";

type PartnersTranslator = ReturnType<typeof useTranslations<"App.partners">>;

type MessageField = "name" | "nuit" | "phone" | "email" | "physicalAddress";

type ErrorParam = { error: string } | undefined;

/**
 * The relation vocabulary as a plain array. `@workspace/db/connections`
 * owns it, but that module builds drizzle tables at import time and these
 * schemas are imported by client forms — `satisfies` keeps the two in step
 * without pulling the database into the browser bundle.
 */
export const PARTNER_RELATIONS = ["client-carrier", "subcontract"] as const satisfies readonly ConnectionRelation[];

/** Mozambican NUITs are 9 digits — the key a partner is looked up by. */
export const NUIT_RE = /^\d{9}$/;

/** What a requester may attach to an invitation; long enough for a sentence, not a letter. */
export const CONNECTION_MESSAGE_MAX = 500;

/**
 * The address block is optional and kept as four (possibly empty) strings,
 * the shape `LocationInput` writes and react-hook-form can seed. A
 * half-filled one — text typed, no suggestion picked — is what the
 * refinement rejects; the procedure folds the rest through `AddressSchema`
 * (@workspace/db/types), which decides whether an address was stored or
 * null. Mirrors src/backend/schemas/company.ts.
 */
const optionalLocation = (error?: ErrorParam) => z
    .object({
        address: z.string(),
        placeId: z.string(),
        country: z.string(),
        state: z.string(),
    })
    .partial()
    .refine(
        (value) => !value.address || Boolean(value.placeId && value.country && value.state),
        { ...(error ?? {}), path: ["address"] },
    );

function buildSchema(msg: (field: MessageField) => ErrorParam) {
    return z.object({
        relation: z.enum(PARTNER_RELATIONS),
        name: z.string().nonempty(msg("name")),
        nuit: z.string().regex(NUIT_RE, msg("nuit")),
        phone: z.string().min(9, msg("phone")),
        // Optional: a company registered by its counterpart may have no
        // address on file yet, and the procedure stores a placeholder
        email: z
            .string()
            .refine((value) => !value || z.email().safeParse(value).success, msg("email"))
            .optional(),
        physicalAddress: optionalLocation(msg("physicalAddress")),
    });
}

// Message-free variant used by `partners.register` to validate input
export const RegisterPartnerBaseSchema = buildSchema(() => undefined);

export type RegisterPartnerForm = z.infer<typeof RegisterPartnerBaseSchema>;

// Client-side variant with translated error messages
export function RegisterPartnerSchema(t: PartnersTranslator) {
    return buildSchema((field) => ({ error: t(`register.fields.${field}.error`) }));
}

/** What `partners.request` takes: who, as what, and an optional note. */
export const ConnectionRequestBaseSchema = z.object({
    organizationId: z.string().nonempty(),
    relation: z.enum(PARTNER_RELATIONS),
    message: z.string().max(CONNECTION_MESSAGE_MAX).optional(),
});

export type ConnectionRequestForm = z.infer<typeof ConnectionRequestBaseSchema>;
