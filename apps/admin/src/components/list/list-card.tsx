import { cn } from "@workspace/ui/lib/utils"

/**
 * The surface a list lives on: toolbar, rows and footer in one rounded
 * card that fills the space the page leaves it. Only the rows scroll —
 * the toolbar above and the pagination below stay where they are.
 * `relative` so the bulk bar can float inside it.
 */
export function ListCard({ className, children }: { className?: string; children: React.ReactNode }) {
    return (
        <section
            className={cn(
                "bg-card ring-foreground/5 relative mx-2 mb-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl shadow-md ring-1 dark:ring-foreground/10",
                className,
            )}
        >
            {children}
        </section>
    )
}
