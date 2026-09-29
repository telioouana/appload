// Type-only, like every other feature's types module: this one is read by the
// bell, the popover and the page, and a value import would send the schema's
// drizzle table definitions to the browser with them
import type { NotificationKind, NotificationParams } from "@workspace/db/notifications";

// ---------------------------------------------------------------------------
// Families. The filter groups the vocabulary the way the portal itself is
// organized, so a reader picks "Your loads" without meeting the two dozen kind
// names behind it. Every kind belongs to exactly one family.
// ---------------------------------------------------------------------------

export const KIND_FAMILIES = ["connections", "loads", "orders", "quotes", "messages", "account"] as const;

export type KindFamily = (typeof KIND_FAMILIES)[number];

export const KINDS_BY_FAMILY: Record<KindFamily, NotificationKind[]> = {
    connections: ["connection.requested", "connection.accepted", "connection.declined", "connection.removed"],
    // The company's own orders and trips, whoever moves them
    loads: [
        "movement.requested",
        "movement.quoted",
        "movement.offered",
        "movement.accepted",
        "movement.declined",
        "movement.started",
        "movement.delivered",
        "movement.cancelled",
        "movement.withdrawn",
        "movement.location-alert",
        "movement.document",
        "movement.dispute-opened",
        "movement.dispute-resolved",
    ],
    // Appload's brokerage
    orders: ["order.requested", "order.quoted", "order.booked", "order.status", "order.cancelled", "order.document"],
    quotes: ["quote.received", "quote.accepted", "quote.declined", "quote.withdrawn"],
    // What the parties of a shipment say to each other, on an order or a load
    messages: ["thread.message"],
    account: ["claim.approved", "member.joined", "subscription.changed"],
};

/** The whole vocabulary, as the families spell it out — what the URL is read against. */
const ALL_KINDS = Object.values(KINDS_BY_FAMILY).flat();

/**
 * The message key one kind is rendered from. next-intl reads a dot as one
 * more level of nesting, so "order.booked" would go looking for "booked"
 * under "order" — the catalog carries a dash in its place, and the email
 * renderer builds the same key from the same column.
 *
 * Spelling the keys out as a type is what lets the compiler check that the
 * catalog has one entry per kind wherever they are read as literal keys.
 */
type Dashed<Kind extends string> = Kind extends `${infer Family}.${infer Event}` ? `${Family}-${Event}` : Kind;

export type KindMessageKey = Dashed<NotificationKind>;

export const kindMessageKey = (kind: NotificationKind): KindMessageKey => kind.replace(".", "-") as KindMessageKey;

/**
 * ICU refuses a dash inside a `select` key, so a code a message branches on
 * reaches the catalog as one word: the location alert records its issue as
 * "short-distance" and the copy selects on `shortDistance`.
 */
const selector = (code: string) => code.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

/**
 * A row's params as ICU values. ICU knows strings and numbers; a param a
 * writer left empty (an optional note, a partner with no name on file)
 * becomes an empty slot rather than the word "null" on someone's screen.
 */
export function icuValues(params: NotificationParams): Record<string, string | number> {
    return Object.fromEntries(
        Object.entries(params).map(([key, value]) => {
            if (typeof value === "number") return [key, value];

            const text = String(value ?? "");
            return [key, key === "issue" ? selector(text) : text];
        }),
    );
}

// ---------------------------------------------------------------------------
// Paging. One list of allowed sizes governs the URL parser, the server input
// and the footer's menu; the popover asks for the smallest of them.
// ---------------------------------------------------------------------------

export const PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** The rail's unread badge cadence (plan §7). */
export const UNREAD_POLL_MS = 30_000;

export type PagedResult<T> = {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
};

// ---------------------------------------------------------------------------
// Row shape and where a row points
// ---------------------------------------------------------------------------

/**
 * The page a notification opens, in the object form the typed `Link` takes.
 * A page whose detail is a sheet carries the row id in `?id=`, which is how
 * the list itself writes it.
 */
export type NotificationLink =
    | { pathname: "/appload/details/[orderId]"; params: { orderId: string } }
    | { pathname: "/orders/load/[loadId]"; params: { loadId: string } }
    | { pathname: "/partners"; query: { id: string } }
    | { pathname: "/quotes"; query: { id: string } }
    | { pathname: "/settings" };

/**
 * Where a notification points, read from what its writer recorded: `link` is
 * what the portal navigates with, `path` the same target as one internal
 * route name — what the API row carries and what an email button appends to
 * the portal URL.
 */
export function notificationTarget(
    entityType: string | null,
    entityId: string | null,
): { link: NotificationLink; path: string } | null {
    switch (entityType) {
        // An Appload order has no page of its own any more: the address is a
        // redirect to the reader's own load, so the rows already written and
        // the emails already sent still land somewhere
        case "order":
            return entityId
                ? { link: { pathname: "/appload/details/[orderId]", params: { orderId: entityId } }, path: `/appload/details/${encodeURIComponent(entityId)}` }
                : null;
        case "movement":
            return entityId
                ? { link: { pathname: "/orders/load/[loadId]", params: { loadId: entityId } }, path: `/orders/load/${encodeURIComponent(entityId)}` }
                : null;
        case "connection":
            return entityId
                ? { link: { pathname: "/partners", query: { id: entityId } }, path: `/partners?id=${encodeURIComponent(entityId)}` }
                : null;
        case "quote":
            return entityId
                ? { link: { pathname: "/quotes", query: { id: entityId } }, path: `/quotes?id=${encodeURIComponent(entityId)}` }
                : null;
        case "subscription":
            return { link: { pathname: "/settings" }, path: "/settings" };
        default:
            return null;
    }
}

export type NotificationRow = {
    id: string;
    kind: NotificationKind;
    /** The display values the kind's message is rendered from — scalars only */
    params: NotificationParams;
    entityType: string | null;
    entityId: string | null;
    readAt: Date | null;
    createdAt: Date;
};

// ---------------------------------------------------------------------------
// URL parsing. The URL is the state store: the filters write these params,
// the view reads them, and the RSC prefetch builds the same input from the
// same parser so the first page hydrates instead of refetching.
// ---------------------------------------------------------------------------

type Get = (key: string) => string | null;

const oneOf = <T extends readonly string[]>(value: string | null, allowed: T): T[number] | undefined =>
    value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;

const parsePage = (value: string | null): number => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

const parsePageSize = (value: string | null): number => {
    const parsed = Number(value);
    return (PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
};

export const notificationsListInput = (get: Get) => ({
    unreadOnly: get("unread") === "1" ? (true as const) : undefined,
    kind: oneOf(get("kind"), ALL_KINDS),
    page: parsePage(get("page")),
    pageSize: parsePageSize(get("size")),
});

export type NotificationsListInput = ReturnType<typeof notificationsListInput>;

/** Whether anything narrows the list, so "nothing yet" is told from "nothing matched". */
export const isFilteredNotifications = (get: Get) => Boolean(get("unread") || get("kind"));
