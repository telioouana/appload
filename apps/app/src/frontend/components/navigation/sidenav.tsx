"use client"

import Image from "next/image"
import { useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
    type Icon,
    IconBell,
    IconBox,
    IconBuildingWarehouse,
    IconCalendarCheck,
    IconChartHistogram,
    IconChecks,
    IconFileInvoice,
    IconGavel,
    IconHistory,
    IconLayoutDashboard,
    IconList,
    IconMap2,
    IconMapPinOff,
    IconMessages,
    IconPlus,
    IconSearch,
    IconTruck,
    IconTruckDelivery,
    IconUsers,
    IconUsersGroup,
} from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { Link, usePathname } from "@/i18n/navigation";

import { Button } from "@workspace/ui/components/button";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, useSidebar } from "@workspace/ui/components/sidebar";

import { cn } from "@workspace/ui/lib/utils";
import { NAV_ITEM_CLASSES, NAV_SECTION_LABEL_CLASSES } from "@workspace/ui/lib/nav-tokens";
import { NavPending } from "@workspace/ui/customs/nav/nav-pending";

import { useTRPC } from "@/backend/api/client";
import { UNREAD_POLL_MS } from "@/frontend/pages/notifications/types";
import { useNewLoad } from "@/frontend/pages/movements/hooks/use-new-load";
import { NewLoadSheet } from "@/frontend/pages/movements/sections/new-load-sheet";
import { MOVEMENT_TABS, SECTIONS, defaultTab, type MovementSection, type MovementTab } from "@/frontend/pages/movements/types";

import { NavUser } from "./nav-user";

// Whatever the typed next-intl `Link` accepts as `href`: a plain internal
// pathname for a static route, or the `{ pathname, params }` object form for
// a route with a dynamic segment (e.g. /orders/[section]).
type NavHref = React.ComponentProps<typeof Link>["href"];

/** A navigable leaf. */
type NavLink = {
    Icon: Icon;
    name: string;
    /** Active matching (by path prefix) and the React key */
    match: string;
    path: NavHref;
    /** Rows waiting on this company behind this entry */
    badge?: number;
    /** Of those, the ones that want to be seen first — drivers gone quiet */
    alert?: number;
};

// A parent group, always open; the row itself is never a link. It has no path
// of its own: it reads as current when one of the leaves under it does, or
// when a page under it that belongs to no leaf is open.
type NavGroup = {
    Icon: Icon;
    name: string;
    /** The React key */
    id: string;
    /** A page under the group that belongs to no leaf, so the rail still lights there */
    match?: string;
    items: NavLink[];
    // No badge of its own on purpose: a count on the parent only says that
    // something below needs a hand, never which page to open. The children
    // carry them, each one for the list it leads to.
};

type NavEntry = NavLink | NavGroup;

function ReviewBadge({ count, alert }: { count?: number; alert?: number }) {
    if (!count && !alert) return null;

    // A location alert gets its own red pill beside the plain count, so the
    // rail says "something is wrong" rather than just "something is new"
    return (
        <span className="ml-auto inline-flex items-center gap-1 group-data-[collapsible=icon]:hidden">
            {alert ? (
                <span className="bg-destructive text-destructive-foreground inline-flex h-[18px] min-w-[18px] items-center justify-center gap-0.5 rounded-full px-1.5 text-[11px] font-medium tabular-nums">
                    <IconMapPinOff className="size-3" stroke={2} />
                    {alert > 99 ? "99+" : alert}
                </span>
            ) : null}
            {count ? (
                <span className="bg-primary text-primary-foreground inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums">
                    {count > 99 ? "99+" : count}
                </span>
            ) : null}
        </span>
    );
}

const ORDER_ICONS: Record<MovementSection, Icon> = {
    "all": IconList,
    "procurement": IconSearch,
    "booked": IconCalendarCheck,
    "in-progress": IconTruckDelivery,
    "delivered": IconChecks,
    "disputes": IconGavel,
    "history": IconHistory,
};

/**
 * The portal's rail, in the admin's shape: an unlabelled group for reading
 * the business, Operations for the day's work with the one button that
 * files a load, My company for who it works with and what it owns, and the
 * account menu at the foot. The Orders group is always open, each section
 * one click away from anywhere — the company's own trucks and its partners'
 * are the two tabs of the page a section opens, so each row lands on the
 * tab this company defaults to — and a count sits on exactly the section
 * that needs the company, added up across both tabs.
 */
export function Sidenav({
    orgType,
    ...props
}: React.ComponentProps<typeof Sidebar> & { orgType: "shipper" | "carrier" }) {
    const t = useTranslations("App.shell.sidebar")
    const tl = useTranslations("App.loads.sections")
    const g = useTranslations("General")
    const pathname = usePathname()
    const params = useParams<Record<string, string | string[]>>()
    const searchParams = useSearchParams()
    // A section row keeps the tab the reader is on — My trucks or the
    // partners' — and only falls back to the company's default when the URL
    // names none, so browsing one side never bounces back to the other
    const urlTab = searchParams.get("tab")
    const tab: MovementTab = (MOVEMENT_TABS as readonly string[]).includes(urlTab ?? "") ? (urlTab as MovementTab) : defaultTab(orgType)
    const trpc = useTRPC()
    const { setOpenMobile } = useSidebar()

    const { open: openNewLoad } = useNewLoad()

    // On a phone the nav is a sheet laid over the page, so following a link
    // has to dismiss it — otherwise it sits on top of what it just opened.
    // Keyed on the path so every link is covered, present and future.
    useEffect(() => {
        setOpenMobile(false)
    }, [pathname, setOpenMobile])

    // One cheap read for every badge; a minute stale is fine for a count.
    // Never a page's own query: the rail sits above the pages' hydration, and
    // a key it observed first reaches a page's server render empty. The
    // unread number is the bell's query, which no page suspends on
    const { data: counts } = useQuery({ ...trpc.me.railCounts.queryOptions(), staleTime: 60_000 })
    // Chat is counted on the Chats row and nowhere else: a message writes a
    // `thread.message` notification for every member of the other side, so
    // the bell leaves that kind out of its own count — otherwise one message
    // would be two numbers, cleared by two different actions
    const { data: unread } = useQuery(trpc.notifications.unreadCount.queryOptions(undefined, { refetchInterval: UNREAD_POLL_MS }))
    const { data: chats } = useQuery(trpc.threads.unread.queryOptions(undefined, { refetchInterval: UNREAD_POLL_MS }))

    const carrier = orgType === "carrier"

    const report: NavEntry[] = [
        {
            // Where signing in lands and where the logo goes back to
            Icon: IconLayoutDashboard,
            name: t("work.dashboard"),
            match: "/dashboard",
            path: "/dashboard",
        },
        { Icon: IconChartHistogram, name: t("company.analytics"), match: "/analytics", path: "/analytics" },
    ]

    // A badge is the two tabs' counts added: a section's number is what waits
    // there on either side, and the page it opens carries both
    const sum = (...counts: Array<number | undefined>) =>
        counts.every((count) => count === undefined)
            ? undefined
            : counts.reduce<number>((total, count) => total + (count ?? 0), 0)

    const ops: NavEntry[] = [
        {
            Icon: IconBox,
            name: t("work.orders"),
            id: "orders",
            // A load's own page belongs to no section, so the Orders group
            // owns it — the rail is never blank while one is open
            match: "/orders/load",
            items: SECTIONS.map((section) => ({
                Icon: ORDER_ICONS[section],
                name: tl(section),
                match: `/orders/${section}`,
                path: { pathname: "/orders/[section]", params: { section }, query: { tab } },
                // Offered by a partner and waiting on the company's answer
                // (My trucks), turned down by one and waiting to be placed
                // again (partners), or an Appload offer still to decide —
                // all of it procurement work; held by a dispute on either side
                badge: section === "procurement"
                    ? sum(counts?.received, counts?.declined, counts?.offersToReview)
                    : section === "booked" ? counts?.toDispatch
                        : section === "disputes" ? sum(counts?.disputes.trips, counts?.disputes.orders) : undefined,
            })),
        },
        { Icon: IconMap2, name: t("work.map"), match: "/map", path: "/map" },
        {
            Icon: IconMessages,
            name: t("work.chats"),
            match: "/chats",
            path: "/chats",
            badge: chats?.total,
        },
        {
            Icon: IconBell,
            name: t("work.notifications"),
            match: "/notifications",
            path: "/notifications",
            badge: unread ? unread.count - unread.alerts : undefined,
            alert: unread?.alerts,
        },
    ]

    const company: NavEntry[] = [
        // Who the company works with comes first: one row, and the kinds
        // (clients, transporters, requests) are the pills on the page itself.
        // A shipper only ever connects to transporters, so its row is named
        // for them; a carrier's opens on its clients. The badge is the pending
        // requests either way — the page it opens carries the Requests pill
        {
            Icon: IconBuildingWarehouse,
            name: carrier ? t("company.partners") : t("company.my-transporters"),
            match: "/partners",
            path: { pathname: "/partners/[kind]", params: { kind: carrier ? "clients" : "transporters" } },
            badge: counts?.partners,
        },
        // The standing prices the company keeps with Appload; the loads they
        // turn into live on the Orders page like any other
        { Icon: IconFileInvoice, name: t("company.quotes"), match: "/quotes", path: "/quotes" },
        {
            // Every company may keep a fleet: a carrier's is what it sells, a
            // shipper's moves its own goods between its own sites. One row;
            // trucks, trailers and links are the pills on the page
            Icon: IconTruck,
            name: t("company.fleet"),
            match: "/fleet",
            path: { pathname: "/fleet/[kind]", params: { kind: "trucks" } },
        },
        { Icon: IconUsers, name: t("company.drivers"), match: "/drivers", path: "/drivers" },
        // The people who sign in for the company, which is the members tab
        // of the settings page rather than a page of its own
        { Icon: IconUsersGroup, name: t("company.team"), match: "/settings", path: { pathname: "/settings", query: { tab: "members" } } },
    ]

    // With localized pathnames next-intl hands back the route template
    // ("/orders/[section]"), so the segments are filled back in from the
    // params before a section row can tell it is the one on screen
    const current = pathname.replace(/\[([^\]]+)\]/g, (_, key: string) => {
        const value = params[key]
        return Array.isArray(value) ? value.join("/") : value ?? ""
    })

    // A load's own page sits under /orders too, so an entry tests for an exact
    // segment rather than a prefix that would light "all" up on /orders/load
    const isOn = (match: string) => current === match || current.startsWith(`${match}/`)

    const renderEntries = (entries: NavEntry[]) => entries.map((item) => {
        // A group has nowhere of its own to be: it is current when one of its
        // own sections is, so two groups over one list light up separately
        const isActive = "items" in item
            ? item.items.some((subItem) => isOn(subItem.match)) || (item.match ? isOn(item.match) : false)
            : isOn(item.match);

        return (
            <SidebarMenuItem key={"items" in item ? item.id : item.match}>
                <SidebarMenuButton
                    // Always wrapping our own element: a Link for a leaf, and a
                    // plain div for a group, which has nothing to toggle and so
                    // should not sit in the page as a dead button
                    asChild
                    tooltip={item.name}
                    isActive={isActive}
                    className={cn(...NAV_ITEM_CLASSES, isActive && "bg-linear-to-r/oklch border-[#E67623]/10")}
                >
                    {"items" in item ? (
                        <div className="flex w-full items-center gap-2">
                            <item.Icon className="size-5! shrink-0" stroke={1} />
                            <span className="flex-1 text-left font-medium tracking-tight">
                                {item.name}
                            </span>
                        </div>
                    ) : (
                        <Link href={item.path}>
                            <item.Icon className="size-5!" stroke={1} />
                            <NavPending className="font-medium tracking-tight">
                                {item.name}
                            </NavPending>
                            <ReviewBadge count={item.badge} alert={item.alert} />
                        </Link>
                    )}
                </SidebarMenuButton>

                {"items" in item && (
                    <SidebarMenuSub className="mx-0 border-l-0 px-0 pl-3.5">
                        {item.items.map((subItem) => {
                            const isSubActive = isOn(subItem.match);

                            return (
                                <SidebarMenuSubItem key={subItem.match} className="gap-2">
                                    <SidebarMenuSubButton
                                        asChild
                                        isActive={isSubActive}
                                        // The kit pins sub-item icons to the accent colour, which stays
                                        // dark on the orange hover in light mode; follow the text instead
                                        className={cn(...NAV_ITEM_CLASSES, "[&>svg]:text-current", isSubActive && "bg-linear-to-r/oklch border-[#E67623]/10")}
                                    >
                                        <Link href={subItem.path}>
                                            <subItem.Icon className="size-5!" stroke={1} />
                                            <NavPending className="tracking-tight">
                                                {subItem.name}
                                            </NavPending>
                                            <ReviewBadge count={subItem.badge} />
                                        </Link>
                                    </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                            )
                        })}
                    </SidebarMenuSub>
                )}
            </SidebarMenuItem>
        )
    })

    return (
        <Sidebar variant="inset" collapsible="icon" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild tooltip={g("app-name")}>
                            <Link href="/dashboard">
                                <div className="text-primary-foreground flex aspect-square size-12 items-center justify-center rounded-2xl">
                                    <Image src="/logos/logo-unlabel.svg" alt={g("app-name")} width={40} height={40} className="size-10" unoptimized />
                                </div>
                                <div className="grid flex-1 text-left text-lg leading-tight">
                                    <span className="truncate font-semibold tracking-wide">
                                        {g("app-name")}
                                    </span>
                                    <span className="text-muted-foreground truncate text-sm">
                                        {g("slogan")}
                                    </span>
                                </div>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-2">
                            {renderEntries(report)}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                {/* The areas are told apart by their name rather than a rule:
                    the label says what the links under it are for, and folds
                    away on its own once the rail collapses to icons */}
                <SidebarGroup>
                    <SidebarGroupLabel className={NAV_SECTION_LABEL_CLASSES}>
                        {t("work.label")}
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-2">
                            <NewLoadSheet />
                            {/* Always opens on a partner's load: a transporter's own
                                trucks come from its clients' orders, and a client picks
                                the shape inside the sheet */}
                            <SidebarMenuItem>
                                <SidebarMenuButton asChild tooltip={t("new-load")}>
                                    <Button onClick={() => openNewLoad("partner")}>
                                        <IconPlus />
                                        {t("new-load")}
                                    </Button>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                            {renderEntries(ops)}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                <SidebarGroup>
                    <SidebarGroupLabel className={NAV_SECTION_LABEL_CLASSES}>
                        {t("company.label")}
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-2">
                            {renderEntries(company)}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter>
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    )
}
