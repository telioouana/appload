import { useMessages } from "@workspace/i18n"

import { PageHero } from "@/frontend/components/sections/page-hero"
import { RichContent } from "@/frontend/components/sections/rich-content"

type LegalNamespace = "privacy" | "terms";

type LegalMessages = {
    title: { part1: string; part2: string };
} & Record<string, unknown>;

/**
 * Shared renderer for the terms and privacy pages: an intro `article`
 * block followed by numbered `articleN` sections, walked generically so
 * the legal text stays a pure content edit.
 */
export function LegalPage({ namespace }: { namespace: LegalNamespace }) {
    const messages = useMessages()
    const content = messages[namespace] as LegalMessages

    const articles = Object.entries(content).filter(
        (entry): entry is [string, Record<string, unknown>] =>
            entry[0].startsWith("article") && typeof entry[1] === "object" && entry[1] !== null,
    )

    return (
        <>
            <PageHero title={content.title.part1} accent={content.title.part2} />

            <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
                <div className="space-y-10">
                    {articles.map(([key, article]) => {
                        const { title, ...body } = article
                        return (
                            <article key={key}>
                                {typeof title === "string" && (
                                    <h2 className="mb-4 font-heading text-xl font-bold tracking-tight sm:text-2xl">
                                        {title}
                                    </h2>
                                )}
                                <RichContent
                                    value={body}
                                    className="text-sm leading-relaxed text-muted-foreground sm:text-base"
                                />
                            </article>
                        )
                    })}
                </div>
            </section>
        </>
    )
}
