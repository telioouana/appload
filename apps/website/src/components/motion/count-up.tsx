"use client"

import { useEffect, useRef, useState } from "react"

import { useLocale } from "@workspace/i18n"

type CountUpProps = {
    value: number;
    /** Compact notation (38.5k, 2.1M) instead of grouped digits */
    compact?: boolean;
    prefix?: string;
    suffix?: string;
    /** Animation length in ms */
    duration?: number;
    className?: string;
};

/**
 * Animates 0 → value the first time it scrolls into view (the reference's
 * number-ticker micro-interaction, applied to real database numbers).
 * The real value is rendered on the server — crawlers and no-JS visitors
 * see it — and the animation resets to 0 only when it starts. Reduced-
 * motion users keep the final value.
 */
export function CountUp({
    value,
    compact = false,
    prefix = "",
    suffix = "",
    duration = 1200,
    className,
}: CountUpProps) {
    const locale = useLocale()
    const ref = useRef<HTMLSpanElement>(null)
    const [display, setDisplay] = useState(value)
    const started = useRef(false)

    useEffect(() => {
        const node = ref.current
        if (!node) return

        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

        const observer = new IntersectionObserver(([entry]) => {
            if (!entry?.isIntersecting || started.current) return
            started.current = true
            observer.disconnect()

            // Already showing the final value
            if (reduced || value === 0) return

            setDisplay(0)
            const start = performance.now()
            const tick = (now: number) => {
                const progress = Math.min((now - start) / duration, 1)
                // ease-out cubic
                const eased = 1 - Math.pow(1 - progress, 3)
                setDisplay(value * eased)
                if (progress < 1) requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
        }, { threshold: 0.4 })

        observer.observe(node)
        return () => observer.disconnect()
    }, [value, duration])

    const formatter = new Intl.NumberFormat(locale, compact
        ? { notation: "compact", maximumFractionDigits: 1 }
        : { maximumFractionDigits: 0 })

    return (
        <span ref={ref} className={className}>
            {prefix}
            {formatter.format(display)}
            {suffix}
        </span>
    )
}
