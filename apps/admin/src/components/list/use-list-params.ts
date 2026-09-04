"use client"

import { useCallback, useEffect, useRef, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export type Param = { key: string; value: string | null }

const SYNC_DELAY = 400

/** The current URL with `params` written into its query string. */
const withParams = (params: Param | Param[]) => {
    const url = new URL(window.location.href)
    for (const { key, value } of Array.isArray(params) ? params : [params]) {
        if (value) { url.searchParams.set(key, value) } else { url.searchParams.delete(key) }
    }
    return url.pathname + url.search
}

/**
 * The URL as the list's state store. `set` writes params at once; `sync`
 * writes them after a pause (for typing) and `cancel` drops a pending sync,
 * so a control that writes the URL directly while a sync is queued never
 * has its write undone by the older, stale one. `shallow` writes without
 * routing at all, for params the server does not read.
 */
export function useListParams() {
    const [isPending, startTransition] = useTransition()
    const searchParams = useSearchParams()
    const router = useRouter()
    const timer = useRef<number | null>(null)

    const apply = useCallback((params: Param | Param[]) => {
        const href = withParams(params)
        startTransition(() => {
            router.replace(href, { scroll: false })
        })
    }, [router, startTransition])

    // Next routes native history calls through its own router, so the URL and
    // `useSearchParams` still agree — but nothing re-renders on the server and
    // no data is refetched. Only for state the server has no opinion about;
    // anything that narrows the query has to go through `set` instead.
    const shallow = useCallback((params: Param | Param[]) => {
        window.history.replaceState(null, "", withParams(params))
    }, [])

    const cancel = useCallback(() => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current)
            timer.current = null
        }
    }, [])

    const sync = useCallback((params: Param | Param[]) => {
        cancel()
        timer.current = window.setTimeout(() => {
            timer.current = null
            apply(params)
        }, SYNC_DELAY)
    }, [apply, cancel])

    // A sync queued by a control that unmounts must not fire into the next page
    useEffect(() => cancel, [cancel])

    return { isPending, get: (key: string) => searchParams.get(key), set: apply, shallow, sync, cancel }
}
