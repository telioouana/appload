"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconCancel, IconLoader2, IconX } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Button } from "@workspace/ui/components/button"
import { FieldGroup } from "@workspace/ui/components/field"
import { TextAreaInput } from "@workspace/ui/inputs/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"

import { useQuoteMutations } from "@/frontend/pages/quotes/hooks/use-quote-mutations"
import { DeclineQuoteSchema, type DeclineQuoteForm } from "@/backend/schemas/quote"

/**
 * Turning a standing quote down. The note is optional but it is the only
 * thing the carrier gets back, so it is the whole dialog: a price that was
 * too high and a lane nobody runs are answered very differently.
 */
export function DeclineQuoteDialog({
    quoteId,
    open,
    onOpenChange,
    onDeclined,
}: {
    quoteId: string
    open: boolean
    onOpenChange: (open: boolean) => void
    onDeclined?: () => void
}) {
    const t = useTranslations("App.quotes")
    const { decline } = useQuoteMutations()

    const form = useForm<DeclineQuoteForm>({
        resolver: zodResolver(DeclineQuoteSchema((field) => ({ error: t(`form.errors.${field}`) }))),
        defaultValues: { id: quoteId, note: "" },
    })

    // A reopened dialog starts clean rather than where it was left
    useEffect(() => {
        if (open) form.reset({ id: quoteId, note: "" })
    }, [open, quoteId, form])

    const isPending = decline.isPending

    function onSubmit(values: DeclineQuoteForm) {
        decline.mutate(
            { id: quoteId, note: values.note?.trim() || undefined },
            {
                onSuccess: () => {
                    onOpenChange(false)
                    onDeclined?.()
                },
            },
        )
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!isPending) onOpenChange(next) }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t("decline.title")}</DialogTitle>
                    <DialogDescription>{t("decline.description")}</DialogDescription>
                </DialogHeader>

                <form
                    id="decline-quote-form"
                    onSubmit={(event) => {
                        // The dialog renders in a portal, so React bubbles this
                        // submit to whatever form opened it
                        event.stopPropagation()
                        void form.handleSubmit(onSubmit)(event)
                    }}
                >
                    <FieldGroup className="gap-4">
                        <TextAreaInput
                            name="note"
                            control={form.control}
                            isPending={isPending}
                            label={t("decline.fields.note.label")}
                            placeholder={t("decline.fields.note.placeholder")}
                            description={t("decline.fields.note.description")}
                        />
                    </FieldGroup>
                </form>

                <DialogFooter>
                    <Button type="submit" form="decline-quote-form" variant="destructive" disabled={isPending}>
                        {isPending
                            ? <IconLoader2 className="size-4 animate-spin" stroke={1.5} />
                            : <IconX className="size-4" stroke={1.5} />}
                        {t("actions.decline")}
                    </Button>
                    <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
                        <IconCancel className="size-4" stroke={1.5} />
                        {t("actions.cancel")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
