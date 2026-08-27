import { useMessages, useTranslations } from "@workspace/i18n"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@workspace/ui/components/accordion"

import { Reveal } from "@/components/motion/reveal"
import { PageHero } from "@/frontend/components/sections/page-hero"
import { CtaBand } from "@/frontend/components/sections/cta-band"
import { RichContent } from "@/frontend/components/sections/rich-content"

type FaqEntry = { title: string; description: unknown };
type FaqGroup = { title: string } & Record<string, unknown>;

function faqEntries(group: FaqGroup): [string, FaqEntry][] {
    return Object.entries(group).filter(
        (entry): entry is [string, FaqEntry] =>
            entry[0].startsWith("faq") && typeof entry[1] === "object" && entry[1] !== null,
    )
}

export function FaqView() {
    const t = useTranslations("faq_header")
    const messages = useMessages()

    const groups = (["general", "shipper", "carrier"] as const).map((key) => ({
        key,
        group: messages.faq[key] as FaqGroup,
    }))

    return (
        <>
            <PageHero title={t("title")} subtitle={t("subtitle")} />

            <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
                <div className="space-y-12">
                    {groups.map(({ key, group }) => (
                        <Reveal key={key}>
                            <h2 className="font-heading text-xl font-bold tracking-tight sm:text-2xl">
                                {group.title}
                            </h2>
                            <Accordion type="single" collapsible className="mt-4">
                                {faqEntries(group).map(([entryKey, entry]) => (
                                    <AccordionItem key={entryKey} value={entryKey}>
                                        <AccordionTrigger className="text-left text-sm font-medium sm:text-base">
                                            {entry.title}
                                        </AccordionTrigger>
                                        {/* forceMount keeps answers in the crawlable server HTML;
                                            website.css collapses closed panels via grid-rows */}
                                        <AccordionContent forceMount className="h-auto">
                                            <RichContent value={entry.description} className="text-sm text-muted-foreground sm:text-base" />
                                        </AccordionContent>
                                    </AccordionItem>
                                ))}
                            </Accordion>
                        </Reveal>
                    ))}
                </div>
            </section>

            <CtaBand />
        </>
    )
}
