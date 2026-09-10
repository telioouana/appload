import type { Order } from "@workspace/db/orders"

import { deriveMilestones, type MilestoneEntry, type MilestoneStep } from "@workspace/domain/orders/milestones"

import type { OrderDetail, OrderHistoryEntry } from "@/frontend/pages/orders/types"

export type { MilestoneStep }

/**
 * The chain a trip has walked, from the detail DTO.
 *
 * `deriveMilestones` is written against the stored row, which carries a few
 * stamps the portal never projects (the deal date, the two departure dates
 * and Appload's punctuality verdicts). They are the derivation's FALLBACK
 * for orders whose history predates a stage — the timeline is the primary
 * source, and the portal always has it — so they are handed over as null
 * and the cast below is what says so. Nothing else in the shape is read.
 */
export function orderMilestones(order: OrderDetail, history: OrderHistoryEntry[]): MilestoneStep[] {
    const entries: MilestoneEntry[] = history.map((entry) => ({
        kind: entry.kind,
        toStatus: entry.toStatus,
        createdAt: entry.createdAt,
    }))

    return deriveMilestones(
        {
            status: order.status,
            route: order.route,
            createdAt: order.createdAt,
            expectedLoadingDate: order.expectedLoadingDate,
            expectedOffloadingDate: order.expectedOffloadingDate,
            actualLoadingDate: order.actualLoadingDate,
            actualOffloadingDate: order.actualOffloadingDate,
            arrivalAtLoading: order.arrivalAtLoading,
            arrivalAtOffloading: order.arrivalAtOffloading,
            arrivalAtBorder: order.arrivalAtBorder,
            dealDate: null,
            departureLoadingDate: null,
            departureOffloadingDate: null,
            arrivalOnTimeLoading: null,
            arrivalOnTimeOffloading: null,
        } as unknown as Order,
        entries,
    )
}
