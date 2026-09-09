"use client"

import { useSuspenseQuery } from "@tanstack/react-query";
import { IconBuilding, IconRosetteDiscountCheck, IconUser, IconUsers } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";

import { useTRPC } from "@/backend/api/client";
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
 */
export function SettingsView() {
    const t = useTranslations("App.settings")
    const trpc = useTRPC()

    const { data } = useSuspenseQuery(trpc.me.session.queryOptions())

    const canManage = data.role === "owner" || data.role === "admin"

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h1 className="font-heading text-2xl font-bold tracking-tight">{t("title")}</h1>
                <p className="text-muted-foreground text-sm">{t("description")}</p>
            </div>

            <Tabs defaultValue="profile" className="gap-4">
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
                    <SubscriptionCard plan={data.plan} organization={data.organization} />
                </TabsContent>
            </Tabs>
        </div>
    )
}
