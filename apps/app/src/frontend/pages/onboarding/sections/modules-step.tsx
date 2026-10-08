"use client"

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { IconArrowRight } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { domainErrorCode } from "@workspace/trpc/errors";
import { moduleConflict, modulesFor, type ModuleId, type ModuleOrgType } from "@workspace/auth/organization-modules";

import { Button } from "@workspace/ui/components/button";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { useTRPC } from "@/backend/api/client";
import { MODULE_ERROR_CODES, ModuleRow, type ModuleErrorCode } from "@/frontend/pages/settings/components/modules-card";

/**
 * The questions right after the company exists: what it runs and what it
 * will use, every switch on until the CEO says otherwise. Continuing always
 * writes the answer — an empty OFF list included — so the company counts as
 * configured and the dashboard stops asking.
 */
export function ModulesStep({ orgType, onDone }: { orgType: ModuleOrgType; onDone: () => void }) {
    const t = useTranslations("App.onboarding.modules")
    const tSettings = useTranslations("App.settings.modules")
    const tm = useTranslations("App.modules")
    const trpc = useTRPC()

    const [off, setOff] = useState<ModuleId[]>([])
    const [error, setError] = useState<ModuleErrorCode | null>(null)

    const set = useMutation(trpc.me.setModules.mutationOptions())

    function submit() {
        setError(null)
        set.mutate({ disabled: off }, {
            onSuccess: () => onDone(),
            onError: (err) => setError(domainErrorCode(err, MODULE_ERROR_CODES, "UNKNOWN")),
        })
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("title")}</CardTitle>
                <CardDescription>{t("description")}</CardDescription>
            </CardHeader>

            <CardContent className="grid gap-4">
                {error && (
                    <Alert variant="destructive">
                        <AlertTitle>{error === "UNKNOWN" ? tSettings("error") : tSettings(`conflict.${error}`)}</AlertTitle>
                    </Alert>
                )}

                <ul className="divide-y">
                    {modulesFor(orgType).map((id) => {
                        const on = !off.includes(id)
                        const conflict = on ? moduleConflict(orgType, [...off, id]) : null

                        return (
                            <ModuleRow
                                key={id}
                                id={id}
                                label={tm(`${id}.question`)}
                                checked={on}
                                disabled={set.isPending || conflict !== null}
                                hint={conflict ? tSettings(`conflict.${conflict}`) : null}
                                onCheckedChange={(next) => setOff(next ? off.filter((other) => other !== id) : [...off, id])}
                            />
                        )
                    })}
                </ul>
            </CardContent>

            <CardFooter>
                <Button type="button" disabled={set.isPending} onClick={submit}>
                    <IconArrowRight />
                    {t("continue")}
                </Button>
            </CardFooter>
        </Card>
    )
}
