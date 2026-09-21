"use client"

import { tabOfScope, type MovementScope, type MovementSection, type OrgType } from "@/frontend/pages/movements/types"

/**
 * What a tab is called, under `App.loads.tabs`: My trucks for everyone, and
 * the other side named for what it is to this company — a client's partners
 * are its transporters, a transporter's are its partners.
 */
export const tabLabelKey = (scope: MovementScope, orgType: OrgType): "own" | "transporters" | "partners" =>
    scope === "trips" ? "own" : orgType === "carrier" ? "partners" : "transporters"

/** The typed link to one section of the Orders page, on one of its two tabs. */
export const sectionHref = (scope: MovementScope, section: MovementSection) =>
    ({ pathname: "/orders/[section]" as const, params: { section }, query: { tab: tabOfScope(scope) } })

