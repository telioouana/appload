import { z } from "zod";

import { useTranslations } from "@workspace/i18n";

type ChatsTranslator = ReturnType<typeof useTranslations<"Admin.chats">>;

type MessageField = "driverName" | "driverPhone" | "orderId";

type ErrorParam = { error: string } | undefined;

function buildSchema(msg: (field: MessageField) => ErrorParam) {
    return z.object({
        driverName: z.string().nonempty(msg("driverName")),
        driverPhone: z.string().min(9, msg("driverPhone")),
        orderId: z
            .string()
            .regex(/^APPL\d+\.\d{2}$/, msg("orderId"))
            .optional()
            .or(z.literal("")),
    });
}

// Message-free variant for server-side validation
export const StartChatBaseSchema = buildSchema(() => undefined);

export type StartChatForm = z.infer<typeof StartChatBaseSchema>;

// Client-side variant with translated error messages
export function StartChatSchema(t: ChatsTranslator) {
    return buildSchema((field) => ({ error: t(`new.fields.${field}.error`) }));
}
