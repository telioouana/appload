"use client"

import { useMutation } from "@tanstack/react-query"
import { IconBrandWhatsapp, IconMessagePlus } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"

import { cn } from "@workspace/ui/lib/utils"

import { useRouter } from "@/i18n/navigation"
import { useTRPC } from "@/backend/api/client"
import type { WhatsappStatus } from "@/frontend/pages/partners/types"

/** wa.me wants the number without the plus. */
export const whatsappHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`

/**
 * The WhatsApp mark next to a phone number, shown only when our own chat
 * history has something to say: green and clickable once a message got
 * through or the driver wrote back, struck through when the last message
 * failed, and absent while nobody has tried yet.
 */
export function WhatsappMark({ status, phone, className }: { status: WhatsappStatus; phone: string; className?: string }) {
    const t = useTranslations("Admin.partners.whatsapp")

    if (status === "unknown") return null

    if (status === "unreachable") {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        aria-label={t("unreachable")}
                        className={cn(
                            "text-muted-foreground/60 relative inline-flex after:absolute after:top-1/2 after:-left-0.5 after:h-px after:w-[calc(100%+4px)] after:-rotate-45 after:bg-current",
                            className,
                        )}
                    >
                        <IconBrandWhatsapp className="size-4" stroke={1.5} />
                    </span>
                </TooltipTrigger>
                <TooltipContent>{t("unreachable")}</TooltipContent>
            </Tooltip>
        )
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <a
                    href={whatsappHref(phone)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("confirmed")}
                    data-no-row-click
                    className={cn("text-[var(--status-verified-text)] opacity-80 transition-opacity hover:opacity-100", className)}
                >
                    <IconBrandWhatsapp className="size-4" stroke={1.5} />
                </a>
            </TooltipTrigger>
            <TooltipContent>{t("confirmed")}</TooltipContent>
        </Tooltip>
    )
}

/**
 * For a number nobody has messaged yet: opens a conversation in the chats
 * page, where the first template message becomes the WhatsApp check.
 */
export function StartChatButton({ driverName, phone }: { driverName: string; phone: string }) {
    const t = useTranslations("Admin.partners.whatsapp")
    const trpc = useTRPC()
    const router = useRouter()

    const start = useMutation(trpc.chats.start.mutationOptions({
        onSuccess: ({ conversation }) => router.push({ pathname: "/messages", query: { c: conversation.id } }),
    }))

    return (
        <Button
            variant="outline"
            size="sm"
            disabled={start.isPending}
            onClick={() => start.mutate({ driverName, driverPhone: phone, orderId: "" })}
        >
            {start.isPending ? <Spinner className="size-4" /> : <IconMessagePlus className="size-4" stroke={1.5} />}
            {t("start")}
        </Button>
    )
}
