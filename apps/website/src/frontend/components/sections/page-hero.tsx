import Image from "next/image"

import { cn } from "@workspace/ui/lib/utils"

type PageHeroProps = {
    title: string;
    /** Second headline line, rendered in brand orange */
    accent?: string;
    subtitle?: string;
    /** Optional truck-photo backdrop (public path); renders under the scrim */
    image?: string;
    /** object-position for the backdrop, e.g. "70% center" */
    imagePosition?: string;
    children?: React.ReactNode;
    className?: string;
};

/**
 * Compact full-bleed dark hero for secondary pages — same visual language
 * as the home banner, one size down. With `image` set, the canvas gains
 * the photo backdrop (full-strength photo → veil → bottom fade → spot).
 */
export function PageHero({ title, accent, subtitle, image, imagePosition, children, className }: PageHeroProps) {
    return (
        <section>
            <div className={cn("relative overflow-hidden bg-(--canvas)", className)}>
                {image && (
                    <>
                        <Image
                            src={image}
                            alt=""
                            aria-hidden
                            fill
                            priority
                            quality={70}
                            sizes="100vw"
                            className="object-cover"
                            style={imagePosition ? { objectPosition: imagePosition } : undefined}
                        />
                        <div className="canvas-veil pointer-events-none absolute inset-0" aria-hidden />
                        <div className="canvas-bottom-fade pointer-events-none absolute inset-x-0 bottom-0 h-24" aria-hidden />
                    </>
                )}
                <div className="canvas-spot pointer-events-none absolute inset-0" aria-hidden />
                <div className="relative mx-auto max-w-4xl px-4 pt-28 pb-16 text-center sm:px-6 sm:pt-32 sm:pb-20">
                    <h1
                        className="enter font-heading text-[clamp(1.9rem,5vw,3.25rem)] font-extrabold uppercase leading-[1.08] tracking-tight text-white"
                        style={{ "--enter-delay": "0ms" } as React.CSSProperties}
                    >
                        {title}
                        {accent && (
                            <>
                                <br />
                                <span className="text-(--brand-orange)">{accent}</span>
                            </>
                        )}
                    </h1>
                    {subtitle && (
                        <p
                            className="enter mx-auto mt-5 max-w-xl text-balance text-sm leading-relaxed text-(--canvas-muted) sm:text-base"
                            style={{ "--enter-delay": "140ms" } as React.CSSProperties}
                        >
                            {subtitle}
                        </p>
                    )}
                    {children}
                </div>
            </div>
        </section>
    )
}
