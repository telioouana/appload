import { useLocale, type Locale } from "@workspace/i18n"
import { cn } from "@workspace/ui/lib/utils"

import { routing } from "@/i18n/routing"
import { Link, getPathname } from "@/i18n/navigation"
import type { AppPathname } from "@/lib/seo"

/**
 * Renders the old site's nested message structures without enumerating
 * every key: strings become paragraphs, `bullet*` keys collect into lists,
 * and nested objects recurse. Handles all the shapes found in the ported
 * dictionaries — `{p1, p2}`, `{info, bullet1..n}`, `{text, link}`, plain
 * strings — for FAQ answers, insurance Q&As and the legal pages.
 */
export function RichContent({ value, className }: { value: unknown; className?: string }) {
    const locale = useLocale() as Locale
    return <div className={cn("space-y-3", className)}>{renderNode(value, locale)}</div>
}

function renderNode(value: unknown, locale: Locale): React.ReactNode {
    if (typeof value === "string") {
        return <p className="leading-relaxed">{value}</p>
    }

    if (typeof value !== "object" || value === null) return null

    const entries = Object.entries(value as Record<string, unknown>)
    const output: React.ReactNode[] = []
    let bullets: { key: string; text: string }[] = []

    const flushBullets = () => {
        if (!bullets.length) return
        output.push(
            <ul key={`bullets-${bullets[0]?.key}`} className="list-disc space-y-1.5 pl-5">
                {bullets.map((bullet) => (
                    <li key={bullet.key} className="leading-relaxed">{bullet.text}</li>
                ))}
            </ul>,
        )
        bullets = []
    }

    for (const [key, entry] of entries) {
        // `link` values that are internal pathnames become localized links;
        // the old dictionaries' external URLs and plain labels (pointing at
        // pages that no longer exist) stay dropped
        if (key === "link") {
            if (typeof entry === "string" && entry in routing.pathnames) {
                const href = entry as AppPathname
                flushBullets()
                output.push(
                    <p key={key} className="leading-relaxed">
                        <Link href={href}>{`appload.co.mz${getPathname({ href, locale })}`}</Link>
                    </p>,
                )
            }
            continue
        }

        if (key.startsWith("bullet") && typeof entry === "string") {
            bullets.push({ key, text: entry })
            continue
        }

        flushBullets()

        if (typeof entry === "string") {
            output.push(<p key={key} className="leading-relaxed">{entry}</p>)
        } else if (typeof entry === "object" && entry !== null) {
            output.push(<div key={key} className="space-y-3">{renderNode(entry, locale)}</div>)
        }
    }

    flushBullets()
    return output
}
