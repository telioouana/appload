"use client"

import { toast } from "sonner"
import { useMutation } from "@tanstack/react-query"
import { IconBrandWhatsapp, IconChevronDown, IconMessage2, IconMessages } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { Link, useRouter } from "@/i18n/navigation"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { useTRPC } from "@/backend/api/client"
import { ACTIVE_STATUSES } from "@/frontend/pages/orders/types"
import type { OrderStatus } from "@workspace/domain/orders/transitions"

/** The statuses whose thread should be linked to this order. */
const LINKABLE: OrderStatus[] = ACTIVE_STATUSES

/**
 * The order's two conversations, from the header: the driver on WhatsApp and
 * the thread between the parties. Both open on the chats page — the page owns
 * the reading, this only says which conversation.
 *
 * `chats.start` upserts on the phone number, so the driver item both finds an
 * existing conversation and creates a missing one, and the id it returns is
 * what the page opens. The order id only rides along for an order the driver
 * is actually running: passing it for a finished one would relink their live
 * thread to a load that ended weeks ago.
 */
export function OpenChatButton({
    driverName,
    driverPhone,
    orderId,
    status,
}: {
    driverName: string | null
    driverPhone: string | null
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
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={start.isPending}>
                    {start.isPending ? <Spinner className="size-4" /> : <IconMessages />}
                    <span className="hidden sm:inline">{t("openChat")}</span>
                    <IconChevronDown />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
                {driverPhone && (
                    <DropdownMenuItem
                        onSelect={() => start.mutate({
                            driverName: driverName ?? driverPhone,
                            driverPhone,
                            orderId: LINKABLE.includes(status) ? orderId : "",
                        })}
                    >
                        <IconBrandWhatsapp stroke={1.5} />
                        {t("chatDriver")}
                    </DropdownMenuItem>
                )}

                <DropdownMenuItem asChild>
                    <Link href={{ pathname: "/chats", query: { o: orderId } }}>
                        <IconMessage2 stroke={1.5} />
                        {t("chatOrder")}
                    </Link>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
