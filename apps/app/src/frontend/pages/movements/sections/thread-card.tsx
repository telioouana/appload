"use client"

import { useQuery } from "@tanstack/react-query"
import { IconAlertCircle, IconCheck, IconChecks, IconClock } from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { Bubble, BubbleContent, BubbleGroup } from "@workspace/ui/components/bubble"
import { TRAIL_POLL_MS } from "@workspace/maps/types"
import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import type { MovementDetail, MovementThreadItem } from "@/frontend/pages/movements/types"

/**
 * What has been said to the driver on WhatsApp, on the Chats page.
 * Read-only on the portal: a position request goes out from the load's own
 * tracking card, the driver answers in WhatsApp, and both land here — which
 * is why this polls on the same clock as the trail, so an answer and the pin
 * it carries appear together.
 */
export function ThreadCard({ load }: { load: Pick<MovementDetail, "id"> }) {
    const t = useTranslations("App.loads.thread")
    const trpc = useTRPC()

    const { data: messages = [] } = useQuery(
        trpc.movements.thread.queryOptions({ id: load.id }, { refetchInterval: TRAIL_POLL_MS }),
    )

    return (
        <SectionCard title={t("title")} count={messages.length}>
            {messages.length === 0 ? (
                <EmptyValue label={t("empty")} />
            ) : (
                <BubbleGroup className="gap-3">
                    {messages.map((message) => <Line key={message.id} message={message} />)}
                </BubbleGroup>
            )}

            <p className="text-muted-foreground text-xs">{t("footer")}</p>
        </SectionCard>
    )
}

function Line({ message }: { message: MovementThreadItem }) {
    const f = useFormatter()
    const now = useNow({ updateInterval: 60_000 })

    const outbound = message.direction === "outbound"

    return (
        <div className={cn("flex min-w-0 flex-col gap-0.5", outbound && "items-end")}>
            <Bubble variant={outbound ? "tinted" : "muted"} align={outbound ? "end" : "start"}>
                <BubbleContent className="text-[13px]">
                    <Body body={message.body} />
                </BubbleContent>
            </Bubble>

            <span className="text-muted-foreground flex items-center gap-1 px-1 text-[11px]">
                {f.relativeTime(message.createdAt, now)}
                {outbound && message.status && <StatusTick status={message.status} />}
            </span>
        </div>
    )
}

/**
 * A message body as the driver's phone sent it — text, never markup. A
 * location share arrives as a place and a maps link, so the bare `https`
 * runs in it are the one thing made tappable.
 */
function Body({ body }: { body: string }) {
    return (
        <>
            {body.split(/(https:\/\/\S+)/).map((part, index) => (
                part.startsWith("https://") ? (
                    <a
                        key={index}
                        href={part}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                    >
                        {part}
                    </a>
                ) : (
                    <span key={index}>{part}</span>
                )
            ))}
        </>
    )
}

/** How far the send got, in the one glyph WhatsApp taught everybody to read. */
function StatusTick({ status }: { status: NonNullable<MovementThreadItem["status"]> }) {
    const t = useTranslations("App.loads.thread.status")
    const label = t(status)

    if (status === "failed") return <IconAlertCircle className="text-destructive size-3.5" stroke={1.5} aria-label={label} />
    if (status === "pending") return <IconClock className="size-3.5" stroke={1.5} aria-label={label} />
    if (status === "sent") return <IconCheck className="size-3.5" stroke={1.5} aria-label={label} />

    return <IconChecks className={cn("size-3.5", status === "read" && "text-primary")} stroke={1.5} aria-label={label} />
}
