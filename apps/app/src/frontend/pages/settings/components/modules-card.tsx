"use client"

import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useTranslations } from "@workspace/i18n";
import { domainErrorCode } from "@workspace/trpc/errors";
import { moduleConflict, modulesFor, type ModuleId, type ModuleOrgType } from "@workspace/auth/organization-modules";

import { Switch } from "@workspace/ui/components/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { useTRPC } from "@/backend/api/client";

export const MODULE_ERROR_CODES = ["NOTHING_LEFT_TO_MOVE", "NOT_APPLICABLE", "UNKNOWN"] as const;

export type ModuleErrorCode = (typeof MODULE_ERROR_CODES)[number];

/** The two groups the settings card reads in — how the company works, then what it uses */
const GROUPS: { key: "how" | "uses"; ids: ModuleId[] }[] = [
    { key: "how", ids: ["own-fleet", "subcontracting"] },
    { key: "uses", ids: ["standing-orders", "rentals", "chats", "map", "analytics"] },
]

/**
 * One module as a line: what it is, what it does, and its switch. The
 * registration step reuses it with the module's question as the label.
 */
export function ModuleRow({
    id,
    label,
    checked,
    disabled,
    hint,
    onCheckedChange,
}: {
    id: ModuleId;
    label: string;
    checked: boolean;
    disabled: boolean;
    hint?: string | null;
    onCheckedChange: (next: boolean) => void;
}) {
    const tm = useTranslations("App.modules")

    return (
        <li className="flex items-start justify-between gap-4 py-3">
            <div className="grid gap-0.5">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-muted-foreground text-sm">{tm(`${id}.description`)}</span>
                {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
            </div>
            <Switch checked={checked} disabled={disabled} aria-label={label} onCheckedChange={onCheckedChange} />
        </li>
    )
}

/**
 * Which modules the company has on, read by everybody and written by the
 * real CEO alone — an acting CEO runs the company, but does not reshape it.
 * Every toggle sends the whole OFF list, so the row is always exactly what
 * the CEO last saw; a switch that would leave a transporter with nothing to
 * move with is disabled before the server has to refuse it.
 */
export function ModulesCard({
    orgType,
    modules,
    canEdit,
    actingOwner,
}: {
    orgType: ModuleOrgType;
    modules: ModuleId[];
    canEdit: boolean;
    actingOwner: boolean;
}) {
    const t = useTranslations("App.settings.modules")
    const tm = useTranslations("App.modules")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const set = useMutation(trpc.me.setModules.mutationOptions({
        onSuccess: () => void queryClient.invalidateQueries(trpc.me.session.queryFilter()),
        onError: (error) => {
            const code = domainErrorCode(error, MODULE_ERROR_CODES, "UNKNOWN")
            toast.error(code === "UNKNOWN" ? t("error") : t(`conflict.${code}`))
        },
    }))

    const applicable = modulesFor(orgType)
    const on = new Set(modules)
    const off = applicable.filter((id) => !on.has(id))

    function toggle(id: ModuleId, next: boolean) {
        set.mutate({ disabled: next ? off.filter((other) => other !== id) : [...off, id] })
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("title")}</CardTitle>
                <CardDescription>{t("description")}</CardDescription>
            </CardHeader>

            <CardContent className="grid gap-6">
                {!canEdit && (
                    <p className="text-muted-foreground text-sm">{t(actingOwner ? "acting-owner-hint" : "owner-only")}</p>
                )}

                {GROUPS.map((group) => {
                    const ids = group.ids.filter((id) => applicable.includes(id))
                    if (ids.length === 0) return null

                    return (
                        <section key={group.key} className="grid gap-1">
                            <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t(`groups.${group.key}`)}</h3>
                            <ul className="divide-y">
                                {ids.map((id) => {
                                    const conflict = on.has(id) ? moduleConflict(orgType, [...off, id]) : null

                                    return (
                                        <ModuleRow
                                            key={id}
                                            id={id}
                                            label={tm(`${id}.name`)}
                                            checked={on.has(id)}
                                            disabled={!canEdit || set.isPending || conflict !== null}
                                            hint={canEdit && conflict ? t(`conflict.${conflict}`) : null}
                                            onCheckedChange={(next) => toggle(id, next)}
                                        />
                                    )
                                })}
                            </ul>
                        </section>
                    )
                })}
            </CardContent>
        </Card>
    )
}
