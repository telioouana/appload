import { useMessages } from "@workspace/i18n"
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

type InsuranceEntry = { question: string; answer: unknown };

export function InsuranceView() {
    const messages = useMessages()
    const insurance = messages.insurance_faq as { header: { title: string; subtitle: string } } & Record<string, unknown>

    const entries = Object.entries(insurance).filter(
        (entry): entry is [string, InsuranceEntry] =>
            entry[0].startsWith("faq") && typeof entry[1] === "object" && entry[1] !== null,
    )

    return (
        <>
            <PageHero title={insurance.header.title} subtitle={insurance.header.subtitle} />

            <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
                <Reveal>
                    <Accordion type="single" collapsible>
                        {entries.map(([key, entry]) => (
                            <AccordionItem key={key} value={key}>
                                <AccordionTrigger className="text-left text-sm font-medium sm:text-base">
                                    {entry.question}
                                </AccordionTrigger>
                                {/* forceMount keeps answers in the crawlable server HTML;
                                    website.css collapses closed panels via grid-rows */}
                                <AccordionContent forceMount className="h-auto">
                                    <RichContent value={entry.answer} className="text-sm text-muted-foreground sm:text-base" />
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </Reveal>
            </section>

            <CtaBand />
        </>
    )
}
