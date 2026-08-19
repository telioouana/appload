"use client"

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useTranslations } from "@workspace/i18n";

import { ControlFunc } from "@workspace/ui/inputs/types";
import { SearchInput } from "@workspace/ui/inputs/search";

import { useTRPC } from "@/backend/api/client";
import type { OrganizationType, OrgOption } from "@/backend/api/routers/organizations";
import { RegisterOrganizationDialog } from "@/frontend/pages/order/dialog/register-organization";

/**
 * Type-to-search input backed by the organization registry. The bound form
 * field holds the display name; the matched organization id is reported
 * through `setOrgId` (cleared whenever the text stops matching a
 * selection). Unmatched names offer inline registration.
 */
export const OrganizationInput: ControlFunc<{
    orgType: OrganizationType,
    setOrgId: (id?: string) => void,
}> = ({
    orgType,
    setOrgId,
    ...props
}) => {
        const t = useTranslations("Admin.organization")
        const trpc = useTRPC()

        // SearchInput debounces typing before onQueryChange fires
        const [query, setQuery] = useState("")

        const search = useQuery(
            trpc.organizations.search.queryOptions(
                { type: orgType, query },
                { placeholderData: keepPreviousData },
            ),
        )

        const results = search.data ?? []
        const isLoading = search.isPending || search.isFetching

        return (
            <SearchInput
                {...props}
                options={results.map((organization: OrgOption) => ({ id: organization.id, label: organization.name }))}
                isLoading={isLoading}
                loadingText={t("combobox.loading")}
                emptyText={t("combobox.empty")}
                registerText={(name) => t("combobox.register", { name })}
                onQueryChange={setQuery}
                onSelect={(option) => setOrgId(option?.id)}
                renderRegister={({ query: name, open, close, apply }) => (
                    <RegisterOrganizationDialog
                        type={orgType}
                        open={open}
                        initialName={name}
                        onOpenChange={(next) => { if (!next) close() }}
                        onRegistered={(organization) => apply({ id: organization.id, label: organization.name })}
                    />
                )}
            />
        )
    }
