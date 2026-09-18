"use client";

import { z } from "zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconAlertCircle, IconSearch } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { Button } from "@workspace/ui/components/button";
import { TextInput } from "@workspace/ui/inputs/text";
import { FieldGroup } from "@workspace/ui/components/field";
import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";

import { useTRPC } from "@/backend/api/client";
import { NuitSchema } from "@/frontend/pages/onboarding/types";
import type { NuitLookup } from "@/frontend/pages/onboarding/server/procedures";

/**
 * The only question the screen opens with. Almost every company Appload
 * works with is already in the database (loaded from the logbook), so the
 * NUIT decides between claiming what exists and registering what does not —
 * and it is the one field a partner always has to hand.
 */
export function NuitStep({
    onFound,
}: {
    onFound: (found: { nuit: string; result: NuitLookup }) => void;
}) {
    const t = useTranslations("App.onboarding")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const [error, setError] = useState<string | null>(null)

    const FormSchema = useMemo(() => NuitSchema(t), [t])
    type TypeSchema = z.infer<typeof FormSchema>

    const { control, handleSubmit, formState: { isSubmitting } } = useForm<TypeSchema>({
        resolver: zodResolver(FormSchema),
        defaultValues: { nuit: "" },
    })

    async function onSubmit(values: TypeSchema) {
        setError(null)

        try {
            const result = await queryClient.fetchQuery(
                trpc.onboarding.lookupNuit.queryOptions({ nuit: values.nuit }),
            )

            onFound({ nuit: values.nuit, result })
        } catch {
            setError(t("errors.unknown"))
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("nuit.title")}</CardTitle>
                <CardDescription>{t("nuit.description")}</CardDescription>
            </CardHeader>

            <CardContent className="grid gap-4">
                {error && (
                    <Alert variant="destructive">
                        <IconAlertCircle />
                        <AlertTitle>{error}</AlertTitle>
                    </Alert>
                )}

                <form onSubmit={handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        <TextInput
                            name="nuit"
                            control={control}
                            isPending={isSubmitting}
                            label={t("nuit.label")}
                            placeholder={t("nuit.placeholder")}
                        />

                        <Button disabled={isSubmitting}>
                            <IconSearch />
                            {isSubmitting ? t("nuit.searching") : t("nuit.submit")}
                        </Button>
                    </FieldGroup>
                </form>
            </CardContent>
        </Card>
    )
}
