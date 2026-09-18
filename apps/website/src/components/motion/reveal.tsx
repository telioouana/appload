"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"

type RevealProps = {
    children: React.ReactNode;
    className?: string;
    /** Stagger offset in ms */
    delay?: number;
} & React.HTMLAttributes<HTMLDivElement>;

/**
 * One-shot scroll reveal: renders hidden (CSS .reveal) and flips to
 * .revealed the first time the element enters the viewport. Reduced-motion
 * users see the content immediately (handled in website.css).
 */
export function Reveal({ children, className, delay = 0, ...props }: RevealProps) {
    const ref = useRef<HTMLDivElement>(null)
    const [revealed, setRevealed] = useState(false)

    useEffect(() => {
        const node = ref.current
        if (!node) return

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry?.isIntersecting) {
                    setRevealed(true)
                    observer.disconnect()
                }
            },
            { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
        )

        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    return (
        <div
            ref={ref}
            className={cn("reveal", revealed && "revealed", className)}
            style={delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}
            {...props}
        >
            {children}
        </div>
    )
}
