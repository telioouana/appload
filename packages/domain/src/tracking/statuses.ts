import type { ORDER_STATUS } from "@workspace/db/types";

export type OrderStatus = (typeof ORDER_STATUS)[number];

// Tracking starts when the truck leaves the loading site: asking a driver
// where he is while he is still being loaded costs a message and tells
// nobody anything. From "on-route" to the end of offloading, interrupts and
// the border included, he is pinged twice daily. Leaf module so both the
// tracking cron and the chat layer can share it without an import cycle.
export const TRACKED_STATUSES: OrderStatus[] = [
    "on-route", "stopped", "issue", "at-border", "at-offloading", "offloading",
];
