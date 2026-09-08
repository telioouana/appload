/** How a figure reads; a metric column and a dashboard money row share it */
export type MoneyTone = "negative" | "positive" | "signed"

/**
 * The tint a money figure wears: money out is red, money in is green, and a
 * balance is coloured by its own sign. Untinted without a tone, and a zero
 * is always muted whatever the tone — nothing to move reads as nothing.
 */
export const moneyTone = (tone: MoneyTone | undefined, value: number) => {
    if (value === 0 || !tone) return value === 0 ? "text-muted-foreground" : undefined
    if (tone === "negative" || (tone === "signed" && value < 0)) return "text-destructive"
    return "text-emerald-600 dark:text-emerald-400"
}
