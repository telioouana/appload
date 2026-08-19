"use client"

import { useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useDebouncedCallback } from "@tanstack/react-pacer"

type Param = { key: string; value: string | null }

/**
 * The URL is the state store for every list page: the header writes params,
 * the data view reads them, and the query key derives from them so a change
 * refetches on its own. Refreshing or sharing a filtered list just works.
 *
 * `set` is immediate (for clicks) and `sync` is debounced (for typing); both
 * accept one param or a batch so a multi-field change is a single replace.
 */
export function useListParams() {
    const [isPending, startTransition] = useTransition()
    const searchParams = useSearchParams()
    const router = useRouter()

    const apply = (params: Param | Param[]) => {
        const url = new URL(window.location.href)

        for (const { key, value } of Array.isArray(params) ? params : [params]) {
            if (value) {
                url.searchParams.set(key, value)
            } else {
                url.searchParams.delete(key)
            }
        }

        // Without a transition the browser stalls visibly during the replace
        startTransition(() => {
            router.replace(url.pathname + url.search, { scroll: false })
        })
    }

    const sync = useDebouncedCallback(apply, { wait: 400 })

    return {
        isPending,
        get: (key: string) => searchParams.get(key),
        set: apply,
        sync,
    }
}
