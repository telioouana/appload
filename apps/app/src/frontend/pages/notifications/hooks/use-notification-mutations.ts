"use client"

import { toast } from "sonner"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useTranslations } from "@workspace/i18n"

import { useTRPC } from "@/backend/api/client"

/**
 * Reading notifications. Both mutations refresh every notifications query at
 * once: the badge, the popover and the page are three reads of the same
 * rows, and they have to agree the moment one of them changes. Everything
 * else that writes a notification is somebody else's mutation — the poll is
 * what catches up with those.
 */
export function useNotificationMutations() {
    const t = useTranslations("App.notifications")
    const trpc = useTRPC()
    const queryClient = useQueryClient()

    const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.notifications.pathKey() })

    // Silent on both paths: reading a row is a side effect of opening what it
    // points at, and a failure simply leaves it unread for the next poll to
    // put back on screen
    const markRead = useMutation(trpc.notifications.markRead.mutationOptions({
        onSuccess: () => { void refresh() },
    }))

    const markAllRead = useMutation(trpc.notifications.markAllRead.mutationOptions({
        onSuccess: (data) => { void refresh(); toast.success(t("toasts.all-read", { count: data.read })) },
        onError: () => toast.error(t("errors.unknown")),
    }))

    return { markRead, markAllRead }
}
