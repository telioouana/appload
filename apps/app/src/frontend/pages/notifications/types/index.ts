// Type-only, like every other feature's types module: this one is read by the
// bell, the popover and the page, and a value import would send the schema's
// drizzle table definitions to the browser with them
import type { NotificationKind, NotificationParams } from "@workspace/db/notifications";

// ---------------------------------------------------------------------------
// Families. The filter groups the vocabulary the way the portal itself is
// organized, so a reader picks "Orders" without meeting the twenty-one kind
// names behind it. Every kind belongs to exactly one family.
// ---------------------------------------------------------------------------

export const KIND_FAMILIES = ["connections", "orders", "quotes", "trips", "account"] as const;

export type KindFamily = (typeof KIND_FAMILIES)[number];

export const KINDS_BY_FAMILY: Record<KindFamily, NotificationKind[]> = {
    connections: ["connection.requested", "connection.accepted", "connection.declined", "connection.removed"],
    orders: ["order.requested", "order.quoted", "order.booked", "order.status", "order.cancelled", "order.document"],
    quotes: ["quote.received", "quote.accepted", "quote.declined", "quote.withdrawn"],
    trips: ["trip.started", "trip.delivered", "trip.no-response"],
    account: ["claim.approved", "claim.rejected", "member.joined", "subscription.changed"],
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
 * A row's params as ICU values. ICU knows strings and numbers; a param a
 * writer left empty (an optional note, a partner with no name on file)
 * becomes an empty slot rather than the word "null" on someone's screen.
 */
export function icuValues(params: NotificationParams): Record<string, string | number> {
    return Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, typeof value === "number" ? value : String(value ?? "")]),
    );
}

// ---------------------------------------------------------------------------
// Paging. One list of allowed sizes governs the URL parser, the server input
// and the footer's menu; the popover asks for the smallest of them.
// ---------------------------------------------------------------------------

export const PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** What the popover shows: the last page of everything, unread or not. */
export const POPOVER_PAGE_SIZE = 10;

/** The unread badge's cadence, and the open popover's (plan §7). */
export const UNREAD_POLL_MS = 30_000;
export const POPOVER_POLL_MS = 10_000;

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
    | { pathname: "/orders/details/[orderId]"; params: { orderId: string } }
    | { pathname: "/trips/[tripId]"; params: { tripId: string } }
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
        case "order":
            return entityId
                ? { link: { pathname: "/orders/details/[orderId]", params: { orderId: entityId } }, path: `/orders/details/${encodeURIComponent(entityId)}` }
                : null;
        case "trip":
            return entityId
                ? { link: { pathname: "/trips/[tripId]", params: { tripId: entityId } }, path: `/trips/${encodeURIComponent(entityId)}` }
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
