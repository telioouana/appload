"use client"

import { Card, CardContent } from "@workspace/ui/components/card"

import { cn } from "@workspace/ui/lib/utils"

import { useListParams } from "@/components/list/use-list-params"

export type StatCard = {
    label: string
    value: number
    /**
     * The URL filter this card selects. Omit for the "all" card, which
     * clears them. Each card owns the exact filter its number counts, so
     * the strip cannot show one figure and open a different set of rows.
     */
    filter?: { key: string; value: string }
}

/**
 * The stat strip doubles as the primary filter: each card is a button that
 * writes its filter to the URL, and the active one is tinted. One control
 * instead of a count display next to a separate filter that can disagree
 * with it.
 */
export function StatCards({ cards, filterKeys }: { cards: StatCard[]; filterKeys: readonly string[] }) {
    const { get, set } = useListParams()

    // Selecting a card clears every other filter key, so two cards can
    // never be active at once
    const select = (card: StatCard) =>
        set(filterKeys.map((key) => ({
            key,
            value: card.filter?.key === key ? card.filter.value : null,
        })))

    return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map((card) => {
                const isActive = card.filter
                    ? get(card.filter.key) === card.filter.value
                    : filterKeys.every((key) => get(key) === null)

                return (
                    <Card
                        key={card.label}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isActive}
                        onClick={() => select(card)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                select(card)
                            }
                        }}
                        className={cn(
                            "cursor-pointer transition-colors hover:border-primary/40",
                            isActive && "border-primary bg-primary/5",
                        )}
                    >
                        <CardContent className="flex flex-col gap-1">
                            <span className="text-muted-foreground truncate text-xs font-medium">
                                {card.label}
                            </span>
                            <span className={cn(
                                "text-2xl font-semibold tabular-nums",
                                isActive && "text-primary",
                            )}>
                                {card.value}
                            </span>
                        </CardContent>
                    </Card>
                )
            })}
        </div>
    )
}
