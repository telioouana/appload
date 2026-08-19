import { cn } from "@workspace/ui/lib/utils"

/**
 * A labelled value: a muted caption above its content.
 *
 * This is what lets the dense partner rows survive a phone. The label stays
 * attached to its value, so the same markup reads as a two-column grid of
 * captioned pairs on a narrow screen and as a table row on a wide one —
 * without a header row that would have to scroll away from its data.
 */
export function LabeledField({
    label,
    className,
    children,
}: {
    label: string
    className?: string
    children: React.ReactNode
}) {
    return (
        <div className={cn("flex min-w-0 flex-col gap-1", className)}>
            <span className="text-muted-foreground truncate text-xs font-medium">
                {label}
            </span>
            <div className="truncate text-sm">
                {children}
            </div>
        </div>
    )
}

/** Placeholder for a field with nothing in it — never an empty cell. */
export function EmptyValue({ label }: { label: string }) {
    return <span className="text-muted-foreground/70">{label}</span>
}
