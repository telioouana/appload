"use client"

import { create } from "zustand"

import type { MovementExecution } from "@/frontend/pages/movements/types"

/** One trip, or an order that takes several (a multi-trip order — the `contract` row) */
export type NewLoadKind = "single" | "multi" | "rental"

type NewLoadState = {
    isOpen: boolean
    /**
     * Whether it has ever been opened. The sheet mounts on the first open:
     * the rail sits above every page's hydration boundary, and a sheet that
     * observed the session there on the server would leave the page's own
     * read of it empty until hydration effects ran — which they never do on
     * the server.
     */
    armed: boolean
    /** Which shape the sheet opens on; kept while it slides shut, so its title does not flip mid-close */
    execution: MovementExecution
    /** The contract share the sheet opens prefilled from, when a contract page asked for the load */
    contractAllocationId: string | null
    /** Null until the first question is answered: one trip, or several */
    kind: NewLoadKind | null
    open: (execution: MovementExecution, options?: { contractAllocationId?: string; kind?: NewLoadKind }) => void
    choose: (kind: NewLoadKind) => void
    close: () => void
}

/**
 * Whether the new-load sheet is open, and on which shape. A store rather
 * than the URL: a half-typed load is not a page. The rail's button and the
 * empty states open the one sheet the rail mounts — the rail always on a
 * partner's load, a client's empty My trucks on its own.
 */
export const useNewLoad = create<NewLoadState>((set) => ({
    isOpen: false,
    armed: false,
    execution: "partner",
    contractAllocationId: null,
    kind: null,
    // A load filed from an order's share is one trip by definition; the rail's
    // button knows nothing and asks
    open: (execution, options) => set({
        isOpen: true,
        armed: true,
        execution,
        contractAllocationId: options?.contractAllocationId ?? null,
        kind: options?.kind ?? (options?.contractAllocationId ? "single" : null),
    }),
    choose: (kind) => set({ kind }),
    close: () => set({ isOpen: false }),
}))
