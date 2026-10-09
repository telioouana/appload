import Image from "next/image"
import { IconArrowLeft } from "@tabler/icons-react"

import { getTranslations } from "@workspace/i18n/server"

import { Link } from "@/i18n/navigation"
import { LocaleSwitcher } from "@/frontend/components/locale-switcher"

// The same address the subscription card offers; questions about this page
// go to the same people
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "comercial@apploadafrica.com"

const SECTIONS = ["marketplace", "own", "support", "log", "papers"] as const
const LINKS: Partial<Record<(typeof SECTIONS)[number], "security" | "activity">> = { support: "security", log: "activity" }

export async function generateMetadata() {
    const t = await getTranslations("App.data")

    return { title: t("metadata") }
}

/**
 * The data page (trust wall, T4): what Appload's team can and cannot see of
 * a company's work, in plain words. Outside both route groups on purpose —
 * a company still registering reads it before it has a tenant, and a member
 * reads it from the rail — so it has no gate and no backend: every sentence
 * on it is enforced elsewhere (rls.ts, the support grants, the request log)
 * and must stay true when those change.
 */
export default async function DataPage() {
    const t = await getTranslations("App.data")
    const general = await getTranslations("General")

    return (
        <div className="flex h-svh flex-col overflow-y-auto">
            <header className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
                <Link href="/dashboard" className="flex items-center gap-2">
                    <Image src="/logos/logo-unlabel.svg" alt={general("app-name")} width={32} height={32} className="size-8" unoptimized />
                    <span className="font-semibold tracking-wide">{general("app-name")}</span>
                </Link>
                <LocaleSwitcher />
            </header>

            <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12">
                <article className="flex flex-col gap-8">
                    <div className="flex flex-col gap-3">
                        <h1 className="font-heading text-2xl font-bold tracking-tight">{t("title")}</h1>
                        <p className="text-muted-foreground text-sm leading-6">{t("intro")}</p>
                    </div>

                    {SECTIONS.map((section) => {
                        const tab = LINKS[section]

                        return (
                            <section key={section} className="flex flex-col gap-2">
                                <h2 className="text-base font-semibold">{t(`sections.${section}.title`)}</h2>
                                <p className="text-sm leading-6">{t(`sections.${section}.body`)}</p>
                                {tab && (
                                    <Link href={{ pathname: "/settings", query: { tab } }} className="text-primary w-fit text-sm underline-offset-4 hover:underline">
                                        {t(`sections.${section}.link`)}
                                    </Link>
                                )}
                            </section>
                        )
                    })}

                    <p className="text-muted-foreground text-xs">{t("contact", { email: CONTACT_EMAIL })}</p>

                    <Link href="/dashboard" className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm">
                        <IconArrowLeft className="size-4" stroke={1.5} />
                        {t("back")}
                    </Link>
                </article>
            </main>
        </div>
    )
}
