"use client"

import { useSearchParams } from "next/navigation";
import { useSuspenseQuery } from "@tanstack/react-query";
import { IconBuilding, IconRosetteDiscountCheck, IconUser, IconUsers } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";

import { useTRPC } from "@/backend/api/client";
import { PapersCard } from "@/frontend/pages/fleet/sections/papers-card";
import { CompanyCard } from "@/frontend/pages/settings/components/company-card";
import { ProfileCard } from "@/frontend/pages/settings/components/profile-card";
import { PasswordCard } from "@/frontend/pages/settings/components/password-card";
import { MembersTable } from "@/frontend/pages/settings/components/members-table";
import { SubscriptionCard } from "@/frontend/pages/settings/components/subscription-card";
import { PendingInvitations } from "@/frontend/pages/settings/components/pending-invitations";

/**
 * The partner's own account and their company, in four tabs (plan §9.4).
 *
 * Everything is read from one `me.session` query — the tenant gate's own
 * verdict — rather than from the auth session: the organization row carries
 * the plan and the KYC status, and the session cookie's organization id is
 * not trusted for tenancy anywhere in the portal.
 *
 * A `?tab=` opens the page on that tab, so a link from elsewhere — the
 * rail's Team entry — can land on the one the reader asked for. Only the
 * tab it starts on: which tab is open afterwards is the reader's own, which
 * is why the tabs stay uncontrolled and the query remounts them instead. A
 * reader already on Settings navigates within the same route, so without the
 * key the URL would change and the tab would stay where it was.
 */
export function SettingsView() {
    const t = useTranslations("App.settings")
    // The papers card brings its own namespace, so the company's documents
    // read exactly as a driver's or a vehicle's do
    const tPapers = useTranslations("App.fleet.papers")
    const trpc = useTRPC()
    const searchParams = useSearchParams()

    const { data } = useSuspenseQuery(trpc.me.session.queryOptions())

    const tab = searchParams.get("tab")
    const initialTab = tab === "company" || tab === "members" || tab === "subscription" ? tab : "profile"

    const canManage = data.role === "owner" || data.role === "admin"

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h1 className="font-heading text-2xl font-bold tracking-tight">{t("title")}</h1>
                <p className="text-muted-foreground text-sm">{t("description")}</p>
            </div>

            <Tabs key={initialTab} defaultValue={initialTab} className="gap-4">
                <TabsList>
                    <TabsTrigger value="profile">
                        <IconUser />
                        {t("tabs.profile")}
                    </TabsTrigger>
                    <TabsTrigger value="company">
                        <IconBuilding />
                        {t("tabs.company")}
                    </TabsTrigger>
                    <TabsTrigger value="members">
                        <IconUsers />
                        {t("tabs.members")}
                    </TabsTrigger>
                    <TabsTrigger value="subscription">
                        <IconRosetteDiscountCheck />
                        {t("tabs.subscription")}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="flex flex-col gap-4">
                    <ProfileCard user={data.user} role={data.role} />
                    <PasswordCard />
                </TabsContent>

                <TabsContent value="company" className="flex flex-col gap-4">
                    <CompanyCard organization={data.organization} canEdit={canManage} />

                    {/* The same card the fleet profiles use, on the company
                        itself: one row per slot of its checklist, filed here
                        and reviewed by Appload */}
                    <PapersCard
                        subjectType="organization"
                        subjectId={data.organization.id}
                        title={tPapers("company-title")}
                        className="bg-card"
                    />
                </TabsContent>

                <TabsContent value="members" className="flex flex-col gap-4">
                    <MembersTable
                        organizationId={data.organization.id}
                        organizationName={data.organization.name}
                        viewerId={data.user.id}
                        viewerRole={data.role}
                    />

                    {/* Members see the pending invitations too — knowing who
                        is on the way in is not an owner's secret — but only
                        owners and admins can take one back */}
                    <PendingInvitations organizationId={data.organization.id} canManage={canManage} />
                </TabsContent>

                <TabsContent value="subscription" className="flex flex-col gap-4">
                    <SubscriptionCard
                        allowance={data.allowance}
                        tiers={data.tiers}
                        organization={data.organization}
                    />
                </TabsContent>
            </Tabs>
        </div>
    )
}
