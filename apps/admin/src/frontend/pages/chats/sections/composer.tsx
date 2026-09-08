"use client";

import type { RefObject } from "react";
import { IconMapPin, IconSend } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@workspace/ui/components/input-group";
import { Kbd } from "@workspace/ui/components/kbd";
import { Spinner } from "@workspace/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";

export function Composer({
    draft,
    onDraftChange,
    onSend,
    isSending,
    onRequestLocation,
    isRequestingLocation,
    draftRef,
}: {
    draft: string;
    onDraftChange: (value: string) => void;
    onSend: () => void;
    isSending: boolean;
    onRequestLocation: () => void;
    isRequestingLocation: boolean;
    draftRef: RefObject<HTMLTextAreaElement | null>;
}) {
    const t = useTranslations("Admin.messages");

    return (
        <form
            className="p-4 pt-3"
            onSubmit={(event) => {
                event.preventDefault();
                onSend();
            }}
        >
            <InputGroup>
                <InputGroupTextarea
                    ref={draftRef}
                    rows={1}
                    value={draft}
                    disabled={isSending}
                    placeholder={t("thread.composer")}
                    onChange={(event) => onDraftChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            onSend();
                        }
                    }}
                />
                <InputGroupAddon align="block-end">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <InputGroupButton
                                size="icon-sm"
                                disabled={isRequestingLocation}
                                onClick={onRequestLocation}
                            >
                                {isRequestingLocation ? <Spinner className="size-4" /> : <IconMapPin />}
                                <span className="sr-only">{t("thread.location.request")}</span>
                            </InputGroupButton>
                        </TooltipTrigger>
                        <TooltipContent>{t("thread.location.request")}</TooltipContent>
                    </Tooltip>
                    <Kbd className="ml-auto max-sm:hidden">Enter ↵</Kbd>
                    <InputGroupButton
                        type="submit"
                        variant="default"
                        size="icon-sm"
                        className="rounded-full"
                        disabled={isSending || !draft.trim()}
                    >
                        {isSending ? <Spinner className="size-4" /> : <IconSend />}
                        <span className="sr-only">{t("thread.send")}</span>
                    </InputGroupButton>
                </InputGroupAddon>
            </InputGroup>
        </form>
    );
}
