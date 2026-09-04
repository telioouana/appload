"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconBan, IconCopy, IconDotsVertical, IconEyeExclamation, IconEyeOff, IconLockOpen } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import type { KycStatus, KycSubjectType, RiskLevel } from "@workspace/db/types"
import { isAuthorized } from "@workspace/auth/user-permissions"

import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { Spinner } from "@workspace/ui/components/spinner"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { cn } from "@workspace/ui/lib/utils"

import { useTRPC } from "@/backend/api/client"
import { domainErrorCode } from "@/lib/trpc-error"
import { useStaffRole } from "@/frontend/pages/kyc/sections/document-checklist"

const STANDING_ERROR_CODES = ["NOT_ALLOWED", "INVALID_STATE", "NOT_FOUND", "UNKNOWN"] as const

type StandingErrorCode = (typeof STANDING_ERROR_CODES)[number]

type Action = "flag-risk" | "clear-risk" | "suspend" | "unsuspend"

/**
 * The overflow menu in a profile header: the actions that change a
 * partner's standing (risk flag, suspension), each behind a dialog that
 * demands a note, plus the copy shortcuts. Buttons render from the same
 * permission table the server checks, so a role that cannot act never
 * sees the option.
 */
export function StandingMenu({
    subjectType,
    subjectId,
    kycStatus,
    riskLevel,
    copy = [],
}: {
    subjectType: KycSubjectType
    subjectId: string
    kycStatus: KycStatus
    /** Only organizations carry a risk level */
    riskLevel?: RiskLevel
    copy?: { label: string; value: string }[]
}) {
    const t = useTranslations("Admin.partners.standing")
    const role = useStaffRole()

    const [action, setAction] = useState<Action | null>(null)

    const canFlag = subjectType === "organization" && isAuthorized(role, "risk", ["flag"])
    const canClear = subjectType === "organization" && riskLevel !== undefined && riskLevel !== "none" && isAuthorized(role, "risk", ["clear"])
    const canOverride = isAuthorized(role, "kyc", ["override"])

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t("menu")}>
                        <IconDotsVertical className="size-4" stroke={1.5} />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    {canFlag && (
                        <DropdownMenuItem onSelect={() => setAction("flag-risk")}>
                            <IconEyeExclamation stroke={1.5} />
                            {riskLevel && riskLevel !== "none" ? t("change-risk") : t("flag-risk")}
                        </DropdownMenuItem>
                    )}
                    {canClear && (
                        <DropdownMenuItem onSelect={() => setAction("clear-risk")}>
                            <IconEyeOff stroke={1.5} />
                            {t("clear-risk")}
                        </DropdownMenuItem>
                    )}
                    {canOverride && kycStatus !== "suspended" && (
                        <DropdownMenuItem variant="destructive" onSelect={() => setAction("suspend")}>
                            <IconBan stroke={1.5} />
                            {t("suspend")}
                        </DropdownMenuItem>
                    )}
                    {canOverride && kycStatus === "suspended" && (
                        <DropdownMenuItem onSelect={() => setAction("unsuspend")}>
                            <IconLockOpen stroke={1.5} />
                            {t("unsuspend")}
                        </DropdownMenuItem>
                    )}
                    {(canFlag || canClear || canOverride) && copy.length > 0 && <DropdownMenuSeparator />}
                    {copy.map((entry) => (
                        <DropdownMenuItem key={entry.label} onSelect={() => navigator.clipboard.writeText(entry.value).catch(() => undefined)}>
                            <IconCopy stroke={1.5} />
                            {entry.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            {action && (
                <StandingDialog
                    action={action}
                    subjectType={subjectType}
                    subjectId={subjectId}
                    currentLevel={riskLevel}
                    onClose={() => setAction(null)}
                />
            )}
        </>
    )
}

function StandingDialog({
    action,
    subjectType,
    subjectId,
    currentLevel,
    onClose,
}: {
    action: Action
    subjectType: KycSubjectType
    subjectId: string
    currentLevel?: RiskLevel
    onClose: () => void
}) {
    const t = useTranslations("Admin.partners.standing")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const [note, setNote] = useState("")
    const [level, setLevel] = useState<"watch" | "high">(currentLevel === "high" ? "high" : "watch")
    const [error, setError] = useState<string | null>(null)

    const refresh = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: trpc.partners.pathKey() }),
            queryClient.invalidateQueries({ queryKey: trpc.kyc.pathKey() }),
        ])
        onClose()
    }

    const fail = (caught: unknown) =>
        setError(t(`errors.${domainErrorCode<StandingErrorCode>(caught, STANDING_ERROR_CODES, "UNKNOWN")}`))

    const flag = useMutation(trpc.kyc.flagRisk.mutationOptions({ onSuccess: refresh, onError: fail }))
    const clear = useMutation(trpc.kyc.clearRisk.mutationOptions({ onSuccess: refresh, onError: fail }))
    const suspend = useMutation(trpc.kyc.suspend.mutationOptions({ onSuccess: refresh, onError: fail }))
    const unsuspend = useMutation(trpc.kyc.unsuspend.mutationOptions({ onSuccess: refresh, onError: fail }))

    const isPending = flag.isPending || clear.isPending || suspend.isPending || unsuspend.isPending

    const submit = () => {
        setError(null)
        const trimmed = note.trim()
        if (!trimmed) {
            setError(t("note-required"))
            return
        }

        if (action === "flag-risk") flag.mutate({ organizationId: subjectId, level, reason: trimmed })
        if (action === "clear-risk") clear.mutate({ organizationId: subjectId, note: trimmed })
        if (action === "suspend") suspend.mutate({ subjectType, subjectId, note: trimmed })
        if (action === "unsuspend") unsuspend.mutate({ subjectType, subjectId, note: trimmed })
    }

    return (
        <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t(`dialog.${action}.title`)}</DialogTitle>
                    <DialogDescription>{t(`dialog.${action}.description`)}</DialogDescription>
                </DialogHeader>

                {action === "flag-risk" && (
                    <div role="radiogroup" className="flex gap-2">
                        {(["watch", "high"] as const).map((option) => (
                            <button
                                key={option}
                                type="button"
                                role="radio"
                                aria-checked={level === option}
                                onClick={() => setLevel(option)}
                                className={cn(
                                    "flex-1 cursor-pointer rounded-2xl border px-3 py-2 text-left text-sm transition-colors",
                                    level === option ? "border-primary bg-primary/5" : "hover:bg-muted",
                                )}
                            >
                                <span className="block font-medium">{t(`level.${option}`)}</span>
                                <span className="text-muted-foreground block text-xs">{t(`level.${option}-hint`)}</span>
                            </button>
                        ))}
                    </div>
                )}

                <Textarea
                    value={note}
                    onChange={(event) => { setNote(event.target.value); setError(null) }}
                    placeholder={t(`dialog.${action}.placeholder`)}
                    rows={4}
                    maxLength={1000}
                />

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter>
                    <Button type="button" variant="outline" disabled={isPending} onClick={onClose}>{t("cancel")}</Button>
                    <Button
                        type="button"
                        variant={action === "suspend" ? "destructive" : "default"}
                        disabled={isPending}
                        onClick={submit}
                    >
                        {isPending && <Spinner className="size-4" />}
                        {t(`dialog.${action}.confirm`)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
