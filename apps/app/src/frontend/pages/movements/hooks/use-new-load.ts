"use client"

import { create } from "zustand"

import type { MovementExecution } from "@/frontend/pages/movements/types"

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
    open: (execution: MovementExecution) => void
    close: () => void
}

/**
 * Whether the new-load sheet is open, and on which shape. A store rather
 * than the URL: a half-typed load is not a page. The rail's button, each
 * list's header and the empty states all open the one sheet the rail mounts.
 */
export const useNewLoad = create<NewLoadState>((set) => ({
    isOpen: false,
    armed: false,
    execution: "own-fleet",
    open: (execution) => set({ isOpen: true, armed: true, execution }),
    close: () => set({ isOpen: false }),
}))
