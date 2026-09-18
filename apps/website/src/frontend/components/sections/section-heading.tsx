import type { Icon as TablerIcon } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { Reveal } from "@/components/motion/reveal"

type SectionHeadingProps = {
    chip?: string;
    chipIcon?: TablerIcon;
    title: string;
    subtitle?: string;
    align?: "left" | "center";
    className?: string;
};

/**
 * The reference's section-reveal pattern: category chip pops first, then
 * the headline, then the supporting line — each on its own stagger.
 */
export function SectionHeading({
    chip,
    chipIcon: ChipIcon,
    title,
    subtitle,
    align = "left",
    className,
}: SectionHeadingProps) {
    const centered = align === "center"

    return (
        <div className={cn("max-w-2xl", centered && "mx-auto text-center", className)}>
            {chip && (
                <Reveal>
                    <p
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-3xl border border-(--brand-orange)/30 bg-(--brand-orange)/10 px-3 py-1 text-xs font-medium text-(--brand-orange)",
                        )}
                    >
                        {ChipIcon && <ChipIcon className="size-3.5" aria-hidden />}
                        {chip}
                    </p>
                </Reveal>
            )}
            <Reveal delay={90}>
                <h2 className="mt-4 font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                    {title}
                </h2>
            </Reveal>
            {subtitle && (
                <Reveal delay={180}>
                    <p className="mt-3 text-balance leading-relaxed text-muted-foreground">
                        {subtitle}
                    </p>
                </Reveal>
            )}
        </div>
    )
}
