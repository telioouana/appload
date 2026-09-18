"use client"

import { IconCheck, IconMail } from "@tabler/icons-react";

import { useFormatter, useTranslations } from "@workspace/i18n";

import { cn } from "@workspace/ui/lib/utils";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { PlanUsage } from "@/components/plan-usage";
import type { MeSession } from "@/frontend/pages/settings/server/procedures";

// Plans are agreed commercially and recorded by Appload staff in Admin (plan
// §4.1), so the portal's side of a plan change is a conversation, not a
// checkout
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "comercial@apploadafrica.com"

/**
 * The company's plan, what it has used of this month's tracked movements,
 * the tiers it could be on, and the way to ask for a change. `allowance` is
 * the live verdict (plan and expiry together) — an expired subscription
 * reads as no plan everywhere the gate is applied, so it must read that way
 * here too.
 */
export function SubscriptionCard({
    allowance,
    tiers,
    organization,
}: {
    allowance: MeSession["allowance"]
    tiers: MeSession["tiers"]
    organization: MeSession["organization"]
}) {
    const t = useTranslations("App.settings")
    const tPlan = useTranslations("App.plan")
    const f = useFormatter()

    const expired = allowance.plan !== null && !allowance.active

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
                        <Badge variant={allowance.active ? "default" : "secondary"}>
                            {tPlan(`names.${allowance.active && allowance.plan ? allowance.plan : "none"}`)}
                        </Badge>

                        {allowance.active && (
                            <span className="text-muted-foreground text-sm">
                                {allowance.expiresAt
                                    ? t("subscription.expires", { date: f.dateTime(allowance.expiresAt, { day: "2-digit", month: "long", year: "numeric" }) })
                                    : t("subscription.no-expiry")}
                            </span>
                        )}

                        {expired && allowance.expiresAt && (
                            <span className="text-destructive text-sm">
                                {t("subscription.expired", { date: f.dateTime(allowance.expiresAt, { day: "2-digit", month: "long", year: "numeric" }) })}
                            </span>
                        )}
                    </div>

                    {/* An expired plan already says so in red above; only a
                        company that never had one needs the invitation */}
                    {allowance.active
                        ? <PlanUsage allowance={allowance} />
                        : allowance.plan === null && (
                            <span className="text-muted-foreground text-sm">{t("subscription.none")}</span>
                        )}

                    {organization.portalActivatedAt && (
                        <span className="text-muted-foreground text-xs">
                            {t("subscription.since", {
                                date: f.dateTime(organization.portalActivatedAt, { day: "2-digit", month: "long", year: "numeric" }),
                            })}
                        </span>
                    )}
                </div>

                <div className="grid gap-2">
                    <h3 className="text-sm font-semibold tracking-tight">{t("subscription.tiers.title")}</h3>
                    <ul className="grid gap-2">
                        {tiers.map((tier) => {
                            const current = allowance.active && tier.plan === allowance.plan

                            return (
                                <li
                                    key={tier.plan}
                                    className={cn(
                                        "flex flex-wrap items-center gap-2 text-sm",
                                        current ? "font-medium" : "text-muted-foreground",
                                    )}
                                >
                                    {current && <IconCheck className="size-4 shrink-0" stroke={1.5} />}
                                    <span>{tPlan(`names.${tier.plan}`)}</span>
                                    <span aria-hidden>·</span>
                                    <span>
                                        {tier.quota === null
                                            ? t("subscription.tiers.unlimited")
                                            : t("subscription.tiers.quota", { quota: tier.quota })}
                                    </span>
                                    {current && <Badge variant="outline">{t("subscription.tiers.current")}</Badge>}
                                </li>
                            )
                        })}
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
