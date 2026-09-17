"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconMessage } from "@tabler/icons-react"

import { useFormatter, useNow, useTranslations } from "@workspace/i18n"

import { THREAD_SUBJECT, type ThreadSubject } from "@workspace/db/types"

import { Avatar, AvatarBadge, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ui/components/empty"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@workspace/ui/components/item"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { initials } from "@workspace/ui/customs/list/table-cells"
import { useListParams } from "@workspace/ui/hooks/use-list-params"
import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { ThreadCard } from "@/frontend/pages/movements/sections/thread-card"
import { ChatCard } from "@/frontend/pages/threads/sections/chat-card"

const MODES = ["drivers", "orders"] as const
type Mode = (typeof MODES)[number]

/** The parties' list carries previews; the drivers' is a list of names. */
const THREADS_POLL_MS = 15_000
const DRIVERS_POLL_MS = 60_000

type Subject = { subjectType: ThreadSubject; subjectId: string }

const keyOf = (subject: Subject) => `${subject.subjectType}:${subject.subjectId}`

/** `?t=order:APL-1042` — what a deep link carries, and what the pane opens. */
function parseSubject(value: string | null): Subject | null {
    const at = value?.indexOf(":") ?? -1

    if (!value || at < 1) return null

    const subjectType = value.slice(0, at)
    const subjectId = value.slice(at + 1)

    return subjectId && (THREAD_SUBJECT as readonly string[]).includes(subjectType)
        ? { subjectType: subjectType as ThreadSubject, subjectId }
        : null
}

/**
 * Every conversation this company is in, on one page: what its own drivers
 * said on WhatsApp, and what the other party to a shipment is saying. The
 * list on the left names them, the pane on the right is the conversation.
 *
 * The open one lives in the URL — `?t=<subjectType>:<subjectId>` for a
 * shipment, `?c=<loadId>` for a driver — so the rail, a load's header and a
 * notification can all point at one. The pane renders from the URL rather
 * than from the list, so a shipment nobody has written on yet still opens.
 */
export function ChatsView() {
    const t = useTranslations("App.threads.page")
    const f = useFormatter()
    const now = useNow({ updateInterval: 60_000 })
    const trpc = useTRPC()

    // Written shallowly: the server reads nothing from it, and this page polls
    const params = useListParams()
    const [subject, setSubject] = useState<Subject | null>(() => parseSubject(params.get("t")))
    const [driverId, setDriverId] = useState<string | null>(() => params.get("c"))
    const [mode, setMode] = useState<Mode>(() => params.get("c") ? "drivers" : "orders")

    const threads = useQuery(trpc.threads.list.queryOptions(undefined, { refetchInterval: THREADS_POLL_MS }))
    const drivers = useQuery(trpc.movements.threadList.queryOptions(undefined, { refetchInterval: DRIVERS_POLL_MS }))

    const onDrivers = mode === "drivers"

    const selectSubject = (next: Subject) => {
        setSubject(next)
        params.shallow({ key: "t", value: keyOf(next) })
    }

    const selectDriver = (id: string) => {
        setDriverId(id)
        params.shallow({ key: "c", value: id })
    }

    const loading = onDrivers ? drivers.isPending : threads.isPending
    const rows = onDrivers ? drivers.data ?? [] : threads.data ?? []
    const active = subject && keyOf(subject)

    return (
        <>
            <header className="flex flex-col gap-1 px-2">
                <h1 className="font-heading truncate text-2xl font-semibold tracking-tight">{t("title")}</h1>
            </header>

            <div className="bg-card relative flex min-h-0 flex-1 overflow-hidden rounded-3xl border">
                <aside className="flex w-80 shrink-0 flex-col border-r">
                    <div className="p-3">
                        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
                            <TabsList className="h-8 w-full">
                                {MODES.map((option) => (
                                    <TabsTrigger key={option} value={option} className="text-xs">
                                        {t(`modes.${option}`)}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {loading ? (
                            <div className="flex flex-col gap-1 p-2">
                                {Array.from({ length: 5 }, (_, index) => (
                                    <div key={index} className="flex items-center gap-3 px-3.5 py-3">
                                        <Skeleton className="size-9 rounded-full" />
                                        <div className="flex flex-1 flex-col gap-2">
                                            <Skeleton className="h-3.5 w-3/5" />
                                            <Skeleton className="h-3 w-4/5" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : rows.length === 0 ? (
                            <Empty className="py-10">
                                <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                        <IconMessage />
                                    </EmptyMedia>
                                    <EmptyTitle>{t(onDrivers ? "drivers-empty" : "orders-empty")}</EmptyTitle>
                                </EmptyHeader>
                            </Empty>
                        ) : (
                            <ItemGroup className="gap-1 p-2">
                                {onDrivers
                                    ? (drivers.data ?? []).map((load) => (
                                        <Row
                                            // The conversation is the driver's phone, but the
                                            // load is what the reader is looking at
                                            key={load.id}
                                            title={load.ref}
                                            description={load.driverName}
                                            isActive={load.id === driverId}
                                            onSelect={() => selectDriver(load.id)}
                                        />
                                    ))
                                    : (threads.data ?? []).map((thread) => (
                                        // Two rows can share a subject id on a
                                        // three-deep subcontract; the thread is what
                                        // tells them apart
                                        <Row
                                            key={thread.threadId}
                                            title={thread.label}
                                            // Every listed thread has been written in; a blank
                                            // preview is a message that carried only files
                                            description={thread.lastMessage || t("file-only")}
                                            time={thread.lastMessageAt && f.relativeTime(thread.lastMessageAt, now)}
                                            unread={thread.unread}
                                            isActive={keyOf(thread) === active}
                                            onSelect={() => selectSubject(thread)}
                                        />
                                    ))}
                            </ItemGroup>
                        )}
                    </div>
                </aside>

                <section className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
                    {onDrivers ? (
                        driverId
                            ? <ThreadCard key={driverId} load={{ id: driverId }} />
                            : <Pick label={t("pick")} />
                    ) : (
                        subject
                            ? <ChatCard key={active} subjectType={subject.subjectType} subjectId={subject.subjectId} />
                            : <Pick label={t("pick")} />
                    )}
                </section>
            </div>
        </>
    )
}

/** One conversation in the list, in the shape the admin's list uses. */
function Row({
    title,
    description,
    time,
    unread = 0,
    isActive,
    onSelect,
}: {
    title: string
    description: string | null
    time?: string | null
    unread?: number
    isActive: boolean
    onSelect: () => void
}) {
    // The open conversation is being read by definition, so its badge is noise
    // (and would flicker for up to a poll cycle after markRead)
    const showUnread = unread > 0 && !isActive

    return (
        <Item
            asChild
            size="sm"
            className={cn(
                "cursor-pointer hover:bg-muted/60",
                isActive && "bg-primary/10 hover:bg-primary/10 dark:bg-primary/15 dark:hover:bg-primary/15",
            )}
        >
            <button type="button" onClick={onSelect}>
                <ItemMedia>
                    <Avatar className="size-9">
                        <AvatarFallback>{initials(title)}</AvatarFallback>
                        {showUnread && <AvatarBadge />}
                    </Avatar>
                </ItemMedia>
                <ItemContent className="min-w-0">
                    <ItemTitle className="flex w-full items-center justify-between gap-2">
                        <span className={cn("min-w-0 truncate", showUnread && "font-semibold")}>{title}</span>
                        {time && (
                            <span className="text-muted-foreground shrink-0 text-xs font-normal">{time}</span>
                        )}
                    </ItemTitle>
                    {description && (
                        <ItemDescription className="flex w-full items-center justify-between gap-2">
                            <span className={cn("min-w-0 truncate", showUnread && "text-foreground font-medium")}>
                                {description}
                            </span>
                            {showUnread && <Badge className="shrink-0 px-1.5">{unread}</Badge>}
                        </ItemDescription>
                    )}
                </ItemContent>
            </button>
        </Item>
    )
}

/** Nothing open yet. */
function Pick({ label }: { label: string }) {
    return (
        <Empty className="h-full">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <IconMessage />
                </EmptyMedia>
                <EmptyTitle>{label}</EmptyTitle>
            </EmptyHeader>
        </Empty>
    )
}
