import Image from "next/image"
import { IconBrandLinkedin } from "@tabler/icons-react"

import { useMessages, useTranslations } from "@workspace/i18n"
import { cn } from "@workspace/ui/lib/utils"

import { TEAM, type TeamMember } from "@/content/site"
import { Reveal } from "@/components/motion/reveal"
import { PageHero } from "@/frontend/components/sections/page-hero"
import { CtaBand } from "@/frontend/components/sections/cta-band"

const FOUNDER_KEYS: TeamMember["key"][] = ["claire", "catherine", "fred"]

function MemberCard({ member, role, large = false }: { member: TeamMember; role: string; large?: boolean }) {
    return (
        <div className="group h-full overflow-hidden rounded-3xl border border-border bg-card transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-md">
            <div className={cn("relative overflow-hidden bg-muted", large ? "aspect-[4/4.4]" : "aspect-square")}>
                <Image
                    src={member.image}
                    alt={member.name}
                    fill
                    sizes={large
                        ? "(max-width: 640px) 100vw, 33vw"
                        : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"}
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
                {/* Overlaid on the photo so long names get the card's full width */}
                {member.linkedin && (
                    <a
                        href={member.linkedin}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${member.name} — LinkedIn`}
                        className="absolute right-2.5 top-2.5 flex size-8 items-center justify-center rounded-full bg-background/85 text-muted-foreground backdrop-blur-sm transition-colors hover:bg-background hover:text-(--brand-red)"
                    >
                        <IconBrandLinkedin className="size-4.5" />
                    </a>
                )}
            </div>
            <div className={cn("p-4", large && "p-5")}>
                <h3 className={cn("font-semibold leading-tight", large ? "text-base sm:text-lg" : "text-sm sm:text-base")}>
                    {member.name}
                </h3>
                <p className={cn("mt-1 leading-snug text-(--brand-red)", large ? "text-sm" : "text-xs sm:text-sm")}>
                    {role}
                </p>
            </div>
        </div>
    )
}

function TeamGrid() {
    const messages = useMessages()

    // Founders carry {title, p1..pn} bios; everyone else a plain string
    const roleOf = (member: TeamMember) => {
        const entry = messages.team[member.key] as string | { title: string }
        return typeof entry === "string" ? entry : entry.title
    }

    const founders = TEAM.filter((member) => FOUNDER_KEYS.includes(member.key))
    const rest = TEAM.filter((member) => !FOUNDER_KEYS.includes(member.key))

    return (
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            {/* Founders get their own row, one size up */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {founders.map((member, index) => (
                    <Reveal key={member.key} delay={index * 90}>
                        <MemberCard member={member} role={roleOf(member)} large />
                    </Reveal>
                ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {rest.map((member, index) => (
                    <Reveal key={member.key} delay={(index % 4) * 80}>
                        <MemberCard member={member} role={roleOf(member)} />
                    </Reveal>
                ))}
            </div>
        </section>
    )
}

export function TeamView() {
    const t = useTranslations("team_page")

    return (
        <>
            <PageHero title={t("title")} subtitle={t("subtitle")} />
            <TeamGrid />
            <CtaBand />
        </>
    )
}
