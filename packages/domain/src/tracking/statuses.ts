import type { ORDER_STATUS } from "@workspace/db/types";

export type OrderStatus = (typeof ORDER_STATUS)[number];

// Any order with a truck committed gets pinged twice daily — the full
// active set, including interrupts and the border. Leaf module so both the
// tracking cron and the chat layer can share it without an import cycle.
export const TRACKED_STATUSES: OrderStatus[] = [
    "at-loading", "loading", "waiting-documents",
    "on-route", "stopped", "issue", "at-border", "at-offloading", "offloading",
];
