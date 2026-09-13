"use client"

import { useFormatter, useTranslations } from "@workspace/i18n"

import { SectionCard } from "@workspace/ui/customs/detail/section-card"
import { EmptyValue } from "@workspace/ui/customs/list/empty-value"
import { cn } from "@workspace/ui/lib/utils"

import { useFlagLabel, useStatusLabel } from "@/frontend/pages/movements/components/badges"
import type { MovementDetail, MovementEventView } from "@/frontend/pages/movements/types"

/** What a line on the trail can say, by what its writer recorded. */
const ACTION_KEYS = [
    "offered", "withdrawn", "accepted", "declined", "converted", "updated",
    "received", "paid", "corrected",
    "cost-added", "cost-removed", "document-added", "document-removed",
] as const

type ActionKey = (typeof ACTION_KEYS)[number]

const isActionKey = (value: string): value is ActionKey => (ACTION_KEYS as readonly string[]).includes(value)

/** The codes the doors write as a note when a move was carried up or down a chain. */
const NOTE_CODES = ["EXECUTOR_WITHDREW", "CLIENT_CANCELLED"] as const

type NoteCode = (typeof NOTE_CODES)[number]

const isNoteCode = (value: string): value is NoteCode => (NOTE_CODES as readonly string[]).includes(value)

/**
 * What has happened to the load, newest first, as far as the reader may
 * read it: its moves, the offer round it is part of, the papers, and — for
 * the owner — the money and the costs. A move carried up from the row with
 * the truck names nobody, since the company that made it may be one the
 * reader was never told about.
 */
export function TimelineCard({ load }: { load: MovementDetail }) {
    const t = useTranslations("App.loads.timeline")

    const events = [...load.events].reverse()

    return (
        <SectionCard title={t("title")} count={events.length}>
            {events.length === 0 ? (
                <EmptyValue label={t("empty")} />
            ) : (
                <ol className="flex flex-col">
                    {events.map((event, index) => (
                        <EventLine key={event.id} event={event} load={load} last={index === events.length - 1} />
                    ))}
                </ol>
            )}
        </SectionCard>
    )
}

function EventLine({ event, load, last }: { event: MovementEventView; load: MovementDetail; last: boolean }) {
    const t = useTranslations("App.loads.timeline")
    const f = useFormatter()
    const statusLabel = useStatusLabel()
    const flagLabel = useFlagLabel()

    const headline = (): string => {
        const status = event.toStatus ? statusLabel(event.toStatus, load.execution) : null

        if (event.action === "created" && status) return t("created", { status })
        if (event.action === "accepted-offer") return t("accepted-offer")
        if ((event.kind === "status" || event.kind === "system") && status) return t("moved", { status })
        if (event.kind === "document" && event.action === "sent") {
            return t("confirmation-sent", { to: event.sentTo ?? "" })
        }
        // Who let the load leave with the photos seen is the point of the line
        if (event.kind === "document" && event.action === "approved") return t("photo-approved")

        const key = event.kind === "document" || event.kind === "cost" ? `${event.kind}-${event.action}` : event.action ?? ""

        return isActionKey(key) ? t(`actions.${key}`) : t(`kinds.${event.kind}`)
    }

    const note = event.note && isNoteCode(event.note) ? t(`codes.${event.note}`) : event.note
    // A move nobody on this page made was carried up from the row with the truck
    const actor = event.actorName ?? (event.kind === "system" ? t("from-below") : null)

    return (
        <li className="relative flex gap-3 pb-4 last:pb-0">
            {/* The rail between the dots */}
            {!last && <span className="bg-border absolute top-3 bottom-0 left-[5px] w-px" aria-hidden />}
            <span className={cn(
                "mt-1.5 size-[11px] shrink-0 rounded-full border-2",
                event.kind === "status" || event.kind === "system" ? "border-primary bg-primary/20" : "border-muted-foreground/40 bg-background",
            )} />

            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-medium">{headline()}</span>
                {/* The move went ahead with something still missing; this is what */}
                {event.flags.length > 0 && (
                    <span className="text-destructive text-xs">
                        {t("flags", { list: event.flags.map(flagLabel).join(", ") })}
                    </span>
                )}
                <span className="text-muted-foreground text-xs">
                    {[actor, f.dateTime(event.createdAt, { dateStyle: "medium", timeStyle: "short" })].filter(Boolean).join(" · ")}
                </span>
                {note && <p className="text-muted-foreground mt-1 text-[13px] whitespace-pre-line">{note}</p>}
            </div>
        </li>
    )
}
