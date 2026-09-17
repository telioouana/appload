"use client"

import { toast } from "sonner"
import { useMutation } from "@tanstack/react-query"
import { IconBrandWhatsapp } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { useRouter } from "@/i18n/navigation"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"

import { useTRPC } from "@/backend/api/client"
import { ACTIVE_STATUSES } from "@/frontend/pages/orders/types"
import type { OrderStatus } from "@workspace/domain/orders/transitions"

/** The statuses whose thread should be linked to this order. */
const LINKABLE: OrderStatus[] = ACTIVE_STATUSES

/**
 * Opens the driver's WhatsApp thread from the order. `chats.start` upserts
 * on the phone number, so this both finds an existing conversation and
 * creates a missing one, and the id it returns is what the chats page opens.
 *
 * The order id only rides along for an order the driver is actually running:
 * passing it for a finished one would relink their live thread to a load
 * that ended weeks ago.
 */
export function OpenChatButton({
    driverName,
    driverPhone,
    orderId,
    status,
}: {
    driverName: string | null
    driverPhone: string
    orderId: string
    status: OrderStatus
}) {
    const t = useTranslations("Admin.orders.detailPage")
    const trpc = useTRPC()
    const router = useRouter()

    const start = useMutation(trpc.chats.start.mutationOptions({
        onSuccess: ({ conversation }) => router.push({ pathname: "/chats", query: { c: conversation.id } }),
        onError: () => toast(t("chatFailed")),
    }))

    return (
        <Button
            size="sm"
            variant="outline"
            disabled={start.isPending}
            onClick={() => start.mutate({
                driverName: driverName ?? driverPhone,
                driverPhone,
                orderId: LINKABLE.includes(status) ? orderId : "",
            })}
        >
            {start.isPending
                ? <Spinner className="size-4" />
                : <IconBrandWhatsapp className="size-4" stroke={1.5} />}
            {t("openChat")}
        </Button>
    )
}
