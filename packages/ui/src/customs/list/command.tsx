"use client"

import { createContext, useContext } from "react"

/**
 * Opens the global ⌘K palette from anywhere; the palette listens for it.
 *
 * A window event rather than a callback because the affordance and the
 * palette are mounted in different trees — the palette sits once in the app
 * shell, the hint sits in whichever list header happens to be on screen.
 */
export const COMMAND_EVENT = "appload:command"

const CommandPaletteContext = createContext(false)

/**
 * Wrap the part of an app that has a command palette mounted. The list
 * header shows its ⌘K hint only inside this, so an app without a palette
 * never advertises a shortcut that does nothing — which is why the flag is
 * context and not a prop: it is a fact about the app, not about the page,
 * and threading it through every list header would say otherwise.
 */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
    return <CommandPaletteContext value={true}>{children}</CommandPaletteContext>
}

export const useHasCommandPalette = () => useContext(CommandPaletteContext)

/** Asks the palette to open, from anywhere in the page. */
export const openCommandPalette = () => window.dispatchEvent(new CustomEvent(COMMAND_EVENT))
