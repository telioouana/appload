import { eq } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { IconArrowRight } from "@tabler/icons-react"

import { db } from "@workspace/db/db"
import { auth } from "@workspace/auth/server"
import { organization } from "@workspace/db/users"
import { getTranslations } from "@workspace/i18n/server"
import { getTenantGates } from "@workspace/trpc/tenant-gate"

import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

export async function generateMetadata() {
    const t = await getTranslations("App.dashboard")

    return { title: t("title") }
}

const COMING_NEXT = ["orders", "quotes", "trips", "partners", "analytics"] as const

/**
 * Placeholder home: who you are signed in as, which company the portal is
 * showing and what opens next. M7 replaces it with the real board (tiles,
 * monthly chart, money card, on-the-road map).
 */
export default async function Dashboard() {
    const t = await getTranslations("App.dashboard")

    // The layout has already gated this; the ids are re-read here rather
    // than passed down, because a page must never trust a prop for tenancy
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session) redirect("/sign-in")

    const tenant = await getTenantGates(db, { userId: session.user.id })

    if (!tenant.ok) redirect("/onboarding")

    const [company] = await db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, tenant.organizationId))
        .limit(1)

    return (
        <div className="flex-1 min-h-0 overflow-y-auto py-4">
            <Card className="mx-auto max-w-3xl">
                <CardHeader>
                    <CardTitle className="text-2xl">
                        {t("greeting", { name: session.user.name.trim() || session.user.email })}
                    </CardTitle>
                    <CardDescription>{t("description")}</CardDescription>
                </CardHeader>

                <CardContent className="grid gap-6">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{company?.name}</span>
                        <Badge variant="outline">{t(`type.${tenant.orgType}`)}</Badge>
                        <Badge variant={tenant.plan.isPro ? "default" : "secondary"}>
                            {t(`plan.${tenant.plan.isPro ? "pro" : "free"}`)}
                        </Badge>
                    </div>

                    <div className="grid gap-2">
                        <h2 className="text-sm font-semibold tracking-tight">{t("coming-next.title")}</h2>
                        <ul className="grid gap-2">
                            {COMING_NEXT.map((item) => (
                                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                                    <IconArrowRight className="mt-0.5 size-4 shrink-0" stroke={1.5} />
                                    {t(`coming-next.${item}`)}
                                </li>
                            ))}
                        </ul>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
