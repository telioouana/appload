"use client"

import Image from "next/image"
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Icon, IconBox, IconBuilding, IconBuildingFactory2, IconBuildingWarehouse, IconChartHistogram, IconChecks, IconDeviceDesktopAnalytics, IconGavel, IconHistory, IconLayoutDashboard, IconList, IconLock, IconLockOpen, IconMap2, IconMessages, IconPlus, IconTruck, IconTruckDelivery, IconUsers } from "@tabler/icons-react";

import { routing } from "@/i18n/routing";
import { useTranslations } from "@workspace/i18n";
import { Link, usePathname } from "@/i18n/navigation";

import { Button } from "@workspace/ui/components/button";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, useSidebar } from "@workspace/ui/components/sidebar";

import { cn } from "@workspace/ui/lib/utils";
import { NAV_ITEM_CLASSES, NAV_SECTION_LABEL_CLASSES } from "@workspace/ui/lib/nav-tokens";

import { useTRPC } from "@/backend/api/client";
import { CreateOrderView } from "@/frontend/pages/order/views/create-order-view";
import { useCreateOrder } from "@/frontend/pages/order/hooks/use-create-order";

import { NavPending } from "@workspace/ui/customs/nav/nav-pending";
import { NavUser } from "./nav-user";

// Internal pathnames accepted as `href` by the typed next-intl `Link`.
// Dynamic routes (e.g. /orders/detail/[orderId]) need a params object, so
// they are excluded from the plain-string nav entries.
type AppPathname = Exclude<keyof typeof routing.pathnames, `${string}[${string}`>;

// A navigable leaf: `path` must be a real route.
type NavLink = {
    Icon: Icon;
    name: string;
    path: AppPathname;
    /** Records waiting for review behind this entry */
    badge?: number;
};

// A parent group, always open: `path` is only used for active matching, so
// it is a plain string and never rendered as an `href`.
type NavGroup = {
    Icon: Icon;
    name: string;
    path: string;
    items: NavLink[];
    // No badge of its own on purpose: a count on the parent only says that
    // something below needs a hand, never which page to open. The children
    // carry them, each one for the list it leads to.
};

type NavEntry = NavLink | NavGroup;


// Drivers reply while the operator is on another page, so the unread count
// polls out here. The Messages page refreshes its own list twice as often.
const UNREAD_POLL_MS = 30_000;

function ReviewBadge({ count }: { count?: number }) {
    if (!count) return null;

    return (
        <span className="bg-primary text-primary-foreground ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums group-data-[collapsible=icon]:hidden">
            {count > 99 ? "99+" : count}
        </span>
    );
}

export function Sidenav({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const t = useTranslations("Admin.sidebar")
    const g = useTranslations("General")
    const pathname = usePathname()
    const trpc = useTRPC()
    const { setOpenMobile } = useSidebar()

    const { onOpenChange } = useCreateOrder()

    // On a phone the nav is a sheet laid over the page, so following a link
    // has to dismiss it — otherwise it sits on top of what it just opened.
    // Keyed on the path so every link is covered, present and future.
    useEffect(() => {
        setOpenMobile(false)
    }, [pathname, setOpenMobile])

    // One cheap grouped count per area; a minute stale is fine for a badge
    const { data: queue } = useQuery({ ...trpc.partners.reviewQueue.queryOptions(), staleTime: 60_000 })
    const { data: attention } = useQuery({ ...trpc.orders.attention.queryOptions(), staleTime: 60_000 })
    const { data: unread } = useQuery({ ...trpc.chats.unread.queryOptions(), refetchInterval: UNREAD_POLL_MS })
    // The order conversations are the same page's other list, so their count
    // rides on the same badge
    const { data: threads } = useQuery({ ...trpc.threads.unread.queryOptions(), refetchInterval: UNREAD_POLL_MS })

    const report: NavEntry[] = [
        {
            // Where signing in lands and where the logo goes back to: the
            // board reading what needs a hand today, so it heads the day's
            // work. No badge — every count on it is a link of its own.
            Icon: IconLayoutDashboard,
            name: t("content.report.dashboard"),
            path: "/dashboard",
        },
        {
            Icon: IconChartHistogram,
            name: t("content.report.metrics"),
            path: "/metrics",
        },
        {
            Icon: IconDeviceDesktopAnalytics,
            name: t("content.report.kpis"),
            path: "/kpis",
        },
    ]

    const ops: NavEntry[] = [
        {
            // Always open: the six sections are the day's work, so they stay
            // within one click from anywhere in the app.
            // Each section carries its own count of trips stopped or flagged,
            // so a badge always names the list to open. "All" holds every one
            // of them, so a count there would only repeat its siblings.
            Icon: IconBox,
            name: t("content.ops.orders.orders"),
            path: "/orders",
            items: [
                { Icon: IconList, name: t("content.ops.orders.all"), path: "/orders/all" },
                { Icon: IconLockOpen, name: t("content.ops.orders.prospects"), path: "/orders/prospect", badge: attention?.sections.prospect },
                { Icon: IconLock, name: t("content.ops.orders.booked"), path: "/orders/booked", badge: attention?.sections.booked },
                { Icon: IconTruckDelivery, name: t("content.ops.orders.on-going"), path: "/orders/on-going", badge: attention?.sections["on-going"] },
                { Icon: IconChecks, name: t("content.ops.orders.delivered"), path: "/orders/delivered", badge: attention?.sections.delivered },
                { Icon: IconGavel, name: t("content.ops.orders.disputes"), path: "/orders/disputes", badge: attention?.disputes },
                { Icon: IconHistory, name: t("content.ops.orders.history"), path: "/orders/history", badge: attention?.sections.history },
            ],
        },
        {
            Icon: IconMap2,
            name: t("content.ops.map"),
            path: "/map",
        },
        {
            // Threads waiting on a reply — the page's own list is the only
            // place that breaks them down, so the count comes along
            Icon: IconMessages,
            name: t("content.ops.messages"),
            path: "/chats",
            badge: unread === undefined && threads === undefined
                ? undefined
                : (unread ?? 0) + (threads?.total ?? 0),
        }
    ]

    const management: NavEntry[] = [
        {
            Icon: IconBuildingFactory2,
            name: t("content.management.shippers"),
            path: "/shippers",
            badge: queue?.shippers,
        },
        {
            Icon: IconBuildingWarehouse,
            name: t("content.management.carriers.carriers"),
            path: "/carriers",
            items: [
                {
                    Icon: IconBuilding,
                    name: t("content.management.carriers.companies"),
                    path: "/carriers/all",
                    badge: queue?.carriers,
                },
                {
                    Icon: IconUsers,
                    name: t("content.management.carriers.drivers"),
                    path: "/carriers/drivers",
                    badge: queue?.drivers,
                },
                {
                    Icon: IconTruck,
                    name: t("content.management.carriers.fleets"),
                    path: "/carriers/fleets",
                    badge: queue?.fleet,
                }
            ]
        },
    ]

    const renderEntries = (entries: NavEntry[]) => entries.map((item) => {
        const isActive = pathname.startsWith(item.path);

        return (
            <SidebarMenuItem key={item.path}>
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
                        /* Parent UI: Just a layout, no navigation */
                        <div className="flex w-full items-center gap-2">
                            <item.Icon className="size-5! shrink-0" stroke={1} />
                            <span className="font-medium tracking-tight flex-1 text-left">
                                {item.name}
                            </span>
                            {/* No count on the row: the children carry them, each
                                for its own list */}
                        </div>
                    ) : (
                        /* Leaf UI: Standard navigation link */
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
                            const isSubActive = pathname.startsWith(subItem.path);

                            return (
                                <SidebarMenuSubItem key={subItem.path} className="gap-2">
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

                {/* The two areas are told apart by their name rather than a rule:
                    the label says what the links under it are for, and folds away
                    on its own once the rail collapses to icons */}
                <SidebarGroup>
                    <SidebarGroupLabel className={NAV_SECTION_LABEL_CLASSES}>
                        {t("content.ops.label")}
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-2">
                            <CreateOrderView />
                            <SidebarMenuItem>
                                <SidebarMenuButton asChild>
                                    <Button onClick={onOpenChange}>
                                        <IconPlus />
                                        {t("content.ops.order")}
                                    </Button>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                            {renderEntries(ops)}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                <SidebarGroup>
                    <SidebarGroupLabel className={NAV_SECTION_LABEL_CLASSES}>
                        {t("content.management.label")}
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-2">
                            {renderEntries(management)}
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
