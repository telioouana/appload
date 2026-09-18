import { useTranslations } from "@workspace/i18n";

import { create, updateFields } from "@workspace/domain/orders/schemas";

/**
 * The order payloads live in @workspace/domain (both apps parse the same
 * shapes); what stays here is the translated client wrapper, which is typed
 * against Admin's own message namespaces. The server variants, the form
 * defaults and the types are re-exported so every existing import still
 * resolves through this module.
 */
export {
    CreateOrderSchemaServer,
    UpdateOrderSchemaServer,
    PATCH_ANCHORS,
    orderToUpdateDefaults,
    orderToCreateDefaults,
} from "@workspace/domain/orders/schemas";

export type {
    CreateOrderForm,
    CreateOrderFormInput,
    UpdateOrderForm,
    UpdateOrderFormInput,
} from "@workspace/domain/orders/schemas";

type CreateTranslations = ReturnType<typeof useTranslations<"Admin.order.create">>
type UpdateTranslations = ReturnType<typeof useTranslations<"Admin.order.update">>

// Client side validation form with message requirement
export function CreateOrderSchema(t: CreateTranslations) {
    return create((field) => ({ error: t(`form.errors.validation.${field}`) }))
}

// Client side update validation with translated messages (edit order form)
export function UpdateOrderSchema(t: UpdateTranslations) {
    return updateFields((field) => ({ error: t(`form.errors.validation.${field}`) }))
}
