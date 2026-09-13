"use client"

import Image from "next/image"
import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
    type Icon,
    IconBell,
    IconBox,
    IconBuildingWarehouse,
    IconCalendarClock,
    IconChartHistogram,
    IconChecks,
    IconContainer,
    IconFileInvoice,
    IconHistory,
    IconInbox,
    IconLayoutDashboard,
    IconLink,
    IconList,
    IconLockOpen,
    IconMap2,
    IconPlus,
    IconRoute,
    IconSearch,
    IconSteeringWheel,
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
import { sectionsFor } from "@/frontend/pages/orders/types";
import { useNewLoad } from "@/frontend/pages/movements/hooks/use-new-load";
import { NewLoadSheet } from "@/frontend/pages/movements/sections/new-load-sheet";
import { ORDER_SECTIONS, TRIP_SECTIONS } from "@/frontend/pages/movements/types";

import { NavUser } from "./nav-user";

// Temporary kill switch (2026-09-13): Appload's brokerage is hidden from
// the rail while the portal is shown as the company's own operations hub.
// Flip to true to bring the whole group back (the sections and the quotes);
// the routes under /appload stay reachable by URL either way.
const SHOW_APPLOAD: boolean = false

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
};

// A parent group, always open: `match` is only used for active matching; the
// row itself is never a link.
type NavGroup = {
    Icon: Icon;
    name: string;
    match: string;
    items: NavLink[];
    // No badge of its own on purpose: a count on the parent only says that
    // something below needs a hand, never which page to open. The children
    // carry them, each one for the list it leads to.
};

type NavEntry = NavLink | NavGroup;

function ReviewBadge({ count }: { count?: number }) {
    if (!count) return null;

    return (
        <span className="bg-primary text-primary-foreground ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums group-data-[collapsible=icon]:hidden">
            {count > 99 ? "99+" : count}
        </span>
    );
}

const ORDER_ICONS: Record<(typeof ORDER_SECTIONS)[number], Icon> = {
    "all": IconList,
    "inbox": IconInbox,
    "procurement": IconSearch,
    "booked": IconCalendarClock,
    "in-transit": IconTruckDelivery,
    "delivered": IconChecks,
    "history": IconHistory,
};

const TRIP_ICONS: Record<(typeof TRIP_SECTIONS)[number], Icon> = {
    "all": IconList,
    "planning": IconSteeringWheel,
    "scheduled": IconCalendarClock,
    "in-transit": IconTruckDelivery,
    "delivered": IconChecks,
    "history": IconHistory,
};

const APPLOAD_ICONS: Record<ReturnType<typeof sectionsFor>[number], Icon> = {
    "all": IconList,
    "requests": IconLockOpen,
    "quoted": IconFileInvoice,
    "booked": IconCalendarClock,
    "on-going": IconTruckDelivery,
    "delivered": IconChecks,
    "history": IconHistory,
};

/**
 * The portal's rail, in the admin's shape: an unlabelled group for reading
 * the business, Operations for the day's work with the one button that
 * files a load, Company for what it owns and who it works with, and the
 * account menu at the foot. The three lists of loads are always open, each
 * section one click away from anywhere, and a count sits on exactly the
 * section that needs the company.
 */
export function Sidenav({
    orgType,
    ...props
}: React.ComponentProps<typeof Sidebar> & { orgType: "shipper" | "carrier" }) {
    const t = useTranslations("App.shell.sidebar")
    const tl = useTranslations("App.loads.sections")
    const to = useTranslations("App.orders.sections")
    const g = useTranslations("General")
    const pathname = usePathname()
    const params = useParams<Record<string, string | string[]>>()
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
    const { data: unread } = useQuery(trpc.notifications.unreadCount.queryOptions(undefined, { refetchInterval: UNREAD_POLL_MS }))

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

    const ops: NavEntry[] = [
        {
            Icon: IconBox,
            name: t("work.orders"),
            match: "/orders",
            // A shipper is never offered work, so it has no inbox to open
            items: ORDER_SECTIONS.filter((section) => carrier || section !== "inbox").map((section) => ({
                Icon: ORDER_ICONS[section],
                name: tl(section),
                match: `/orders/${section}`,
                path: { pathname: "/orders/[section]", params: { section } },
                badge: section === "inbox" ? counts?.inbox : section === "procurement" ? counts?.declined : undefined,
            })),
        },
        {
            Icon: IconRoute,
            name: t("work.trips"),
            match: "/trips",
            items: TRIP_SECTIONS.map((section) => ({
                Icon: TRIP_ICONS[section],
                name: tl(section),
                match: `/trips/${section}`,
                path: { pathname: "/trips/[section]", params: { section } },
            })),
        },
        ...(SHOW_APPLOAD ? [{
            // Appload's brokerage, beside the company's own loads: the
            // requests and offers it runs through Appload, and the quotes
            Icon: IconContainer,
            name: t("work.appload"),
            match: "/appload",
            items: [
                ...sectionsFor(orgType).map((section) => ({
                    Icon: APPLOAD_ICONS[section],
                    name: to(section),
                    match: `/appload/${section}`,
                    path: { pathname: "/appload/[section]" as const, params: { section } },
                    badge: carrier
                        ? section === "requests" ? counts?.appload.newRequests : section === "booked" ? counts?.appload.toDispatch : undefined
                        : section === "quoted" ? counts?.appload.offersToReview : undefined,
                })),
                { Icon: IconFileInvoice, name: t("work.quotes"), match: "/appload/quotes", path: "/appload/quotes" },
            ],
        } satisfies NavGroup] : []),
        { Icon: IconMap2, name: t("work.map"), match: "/map", path: "/map" },
        {
            Icon: IconBell,
            name: t("work.notifications"),
            match: "/notifications",
            path: "/notifications",
            badge: unread?.count,
        },
    ]

    const company: NavEntry[] = [
        {
            // Every company may keep a fleet: a carrier's is what it sells, a
            // shipper's moves its own goods between its own sites
            Icon: IconTruck,
            name: t("company.fleet"),
            match: "/fleet",
            items: [
                { Icon: IconTruck, name: t("company.trucks"), match: "/fleet/trucks", path: { pathname: "/fleet/[kind]", params: { kind: "trucks" } } },
                { Icon: IconContainer, name: t("company.trailers"), match: "/fleet/trailers", path: { pathname: "/fleet/[kind]", params: { kind: "trailers" } } },
                { Icon: IconLink, name: t("company.links"), match: "/fleet/links", path: { pathname: "/fleet/[kind]", params: { kind: "links" } } },
            ],
        },
        { Icon: IconUsers, name: t("company.drivers"), match: "/drivers", path: "/drivers" },
        // The people who sign in for the company, which is the members tab
        // of the settings page rather than a page of its own
        { Icon: IconUsersGroup, name: t("company.team"), match: "/settings", path: { pathname: "/settings", query: { tab: "members" } } },
        {
            Icon: IconBuildingWarehouse,
            name: t("company.partners"),
            match: "/partners",
            path: "/partners",
            badge: counts?.partners,
        },
    ]

    // With localized pathnames next-intl hands back the route template
    // ("/orders/[section]"), so the segments are filled back in from the
    // params before a section row can tell it is the one on screen
    const current = pathname.replace(/\[([^\]]+)\]/g, (_, key: string) => {
        const value = params[key]
        return Array.isArray(value) ? value.join("/") : value ?? ""
    })

    // The quotes live under /appload too, so the sections test for an exact
    // segment rather than a prefix that would light "all" up on /appload/quotes
    const isOn = (match: string) => current === match || current.startsWith(`${match}/`)

    const renderEntries = (entries: NavEntry[]) => entries.map((item) => {
        const isActive = isOn(item.match);

        return (
            <SidebarMenuItem key={item.match}>
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
                            <ReviewBadge count={item.badge} />
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
                            <SidebarMenuItem>
                                <SidebarMenuButton asChild tooltip={t("new-load")}>
                                    <Button onClick={() => openNewLoad(carrier ? "own-fleet" : "partner")}>
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
