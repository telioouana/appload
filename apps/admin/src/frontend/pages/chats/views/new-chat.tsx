"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconCancel, IconLoader2, IconMessagePlus } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { Button } from "@workspace/ui/components/button";
import { FieldGroup } from "@workspace/ui/components/field";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";

import { TextInput } from "@workspace/ui/inputs/text";

import { useTRPC } from "@/backend/api/client";
import { domainErrorCode } from "@/lib/trpc-error";
import { StartChatSchema, type StartChatForm } from "@/backend/schemas/start-chat";

import type { ChatConversation } from "@workspace/db/chats";

const ERROR_MESSAGE_KEYS = {
    "INVALID": "invalid",
    "UNAUTHORIZED": "unauthorized",
    "ORDER_NOT_FOUND": "orderNotFound",
    "UNKNOWN": "unknown",
} as const;

type ChatErrorCode = keyof typeof ERROR_MESSAGE_KEYS;

const CHAT_ERROR_CODES = Object.keys(ERROR_MESSAGE_KEYS) as ChatErrorCode[];

export function NewChatDialog({
    open,
    onOpenChange,
    onStarted,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onStarted: (conversation: ChatConversation) => void;
}) {
    const t = useTranslations("Admin.chats");

    const FormSchema = useMemo(() => StartChatSchema(t), [t]);

    const trpc = useTRPC();
    const start = useMutation(trpc.chats.start.mutationOptions());

    const isPending = start.isPending;
    const [error, setError] = useState<ChatErrorCode | null>(null);

    const form = useForm<StartChatForm>({
        resolver: zodResolver(FormSchema),
        defaultValues: { driverName: "", driverPhone: "", orderId: "" },
    });

    useEffect(() => {
        if (open) {
            form.reset({ driverName: "", driverPhone: "", orderId: "" });
        }
    }, [open, form]);

    // Stale submit errors clear on close so a reopened dialog starts clean
    function handleOpenChange(next: boolean) {
        if (!next) setError(null);
        onOpenChange(next);
    }

    function onSubmit(values: StartChatForm) {
        setError(null);

        start.mutate(values, {
            onSuccess: (result) => onStarted(result.conversation),
            onError: (err) => setError(domainErrorCode(err, CHAT_ERROR_CODES, "UNKNOWN")),
        });
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("new.title")}</DialogTitle>
                    <DialogDescription>{t("new.description")}</DialogDescription>
                </DialogHeader>

                <form id="new-chat-form" onSubmit={form.handleSubmit(onSubmit)}>
                    <FieldGroup className="gap-4">
                        <TextInput
                            name="driverName"
                            control={form.control}
                            isPending={isPending}
                            label={t("new.fields.driverName.label")}
                            placeholder={t("new.fields.driverName.placeholder")}
                        />
                        <TextInput
                            name="driverPhone"
                            control={form.control}
                            isPending={isPending}
                            label={t("new.fields.driverPhone.label")}
                            placeholder={t("new.fields.driverPhone.placeholder")}
                        />
                        <TextInput
                            name="orderId"
                            control={form.control}
                            isPending={isPending}
                            label={t("new.fields.orderId.label")}
                            placeholder={t("new.fields.orderId.placeholder")}
                        />
                    </FieldGroup>
                </form>

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>
                            {t(`new.errors.${ERROR_MESSAGE_KEYS[error]}`)}
                        </AlertDescription>
                    </Alert>
                )}

                <DialogFooter>
                    <Button
                        type="submit"
                        form="new-chat-form"
                        disabled={isPending}
                    >
                        {isPending ? <IconLoader2 className="animate-spin" /> : <IconMessagePlus />}
                        {isPending ? t("new.actions.starting") : t("new.actions.start")}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => onOpenChange(false)}
                    >
                        <IconCancel />
                        {t("new.actions.cancel")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
