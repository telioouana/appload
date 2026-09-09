"use client"

import { IconCheck, IconMail } from "@tabler/icons-react";

import { useFormatter, useTranslations } from "@workspace/i18n";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";

import type { MeSession } from "@/frontend/pages/settings/server/procedures";

const FEATURES = ["orders", "trips", "analytics"] as const

// Plans are set by Appload staff in Admin (plan §4), so the portal's side of
// a plan change is a conversation, not a checkout
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "comercial@apploadafrica.com"

/**
 * The company's plan, what pro unlocks, and the way to ask for a change.
 * `plan.isPro` is the live verdict (plan and expiry together) — an expired
 * pro subscription reads as free everywhere the gate is applied, so it must
 * read that way here too.
 */
export function SubscriptionCard({
    plan,
    organization,
}: {
    plan: MeSession["plan"]
    organization: MeSession["organization"]
}) {
    const t = useTranslations("App.settings")
    const f = useFormatter()

    const expired = plan.plan === "pro" && !plan.isPro && plan.expiresAt !== null

    const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
        t("subscription.contact.subject", { organization: organization.name }),
    )}`

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("subscription.title")}</CardTitle>
                <CardDescription>{t("subscription.description")}</CardDescription>
            </CardHeader>

            <CardContent className="grid gap-6">
                <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={plan.isPro ? "default" : "secondary"}>
                            {t(`subscription.plan.${plan.isPro ? "pro" : "free"}`)}
                        </Badge>

                        {plan.isPro && (
                            <span className="text-muted-foreground text-sm">
                                {plan.expiresAt
                                    ? t("subscription.expires", { date: f.dateTime(plan.expiresAt, { day: "2-digit", month: "long", year: "numeric" }) })
                                    : t("subscription.no-expiry")}
                            </span>
                        )}

                        {expired && plan.expiresAt && (
                            <span className="text-destructive text-sm">
                                {t("subscription.expired", { date: f.dateTime(plan.expiresAt, { day: "2-digit", month: "long", year: "numeric" }) })}
                            </span>
                        )}
                    </div>

                    {organization.portalActivatedAt && (
                        <span className="text-muted-foreground text-xs">
                            {t("subscription.since", {
                                date: f.dateTime(organization.portalActivatedAt, { day: "2-digit", month: "long", year: "numeric" }),
                            })}
                        </span>
                    )}
                </div>

                <div className="grid gap-2">
                    <h3 className="text-sm font-semibold tracking-tight">{t("subscription.features.title")}</h3>
                    <ul className="grid gap-2">
                        {FEATURES.map((feature) => (
                            <li key={feature} className="text-muted-foreground flex items-start gap-2 text-sm">
                                <IconCheck className="mt-0.5 size-4 shrink-0" stroke={1.5} />
                                {t(`subscription.features.${feature}`)}
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="bg-muted/40 grid gap-2 rounded-2xl p-4">
                    <span className="text-sm font-medium">{t("subscription.contact.title")}</span>
                    <span className="text-muted-foreground text-sm">{t("subscription.contact.description")}</span>

                    <Button asChild variant="outline" className="justify-self-start">
                        <a href={mailto}>
                            <IconMail />
                            {t("subscription.contact.button")}
                        </a>
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
