"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useTRPC } from "@/backend/api/client"

/**
 * Whether this company's vehicles and drivers go through Appload's
 * verification. A carrier's do: its fleet is what an Appload booking is
 * checked against before a truck is dispatched. A shipper's never reach an
 * Appload order, so nothing about them is ever reviewed — every KYC badge,
 * tile and document card would be a permanent "draft" that nobody can act
 * on, and the pages leave them out instead.
 *
 * The fleet and drivers slots prefetch the session, so this never suspends
 * on a page load.
 */
export function useVerifiedFleet(): boolean {
    const trpc = useTRPC()
    const { data } = useSuspenseQuery(trpc.me.session.queryOptions())

    return data.organization.type === "carrier"
}

/** The columns that only mean something where Appload verifies the fleet. */
const VERIFICATION_COLUMNS = new Set(["status", "ownership", "documents"])

/** A column set with the verification columns left out for a fleet nobody verifies. */
export const withVerification = <T extends { id?: string }>(verified: boolean, columns: T[]): T[] =>
    verified ? columns : columns.filter((column) => !VERIFICATION_COLUMNS.has(column.id ?? ""))
