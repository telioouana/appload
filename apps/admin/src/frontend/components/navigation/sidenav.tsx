"use client"

import Image from "next/image"
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Icon, IconBox, IconBuilding, IconBuildingFactory2, IconBuildingWarehouse, IconChecks, IconChevronRight, IconGavel, IconHistory, IconList, IconLock, IconLockOpen, IconMap2, IconMessages, IconPlus, IconTruck, IconTruckDelivery, IconUsers } from "@tabler/icons-react";

import { routing } from "@/i18n/routing";
import { useTranslations } from "@workspace/i18n";
import { Link, usePathname } from "@/i18n/navigation";

import { Button } from "@workspace/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarSeparator, useSidebar } from "@workspace/ui/components/sidebar";

import { cn } from "@workspace/ui/lib/utils";

import { useTRPC } from "@/backend/api/client";
import { CreateOrderView } from "@/frontend/pages/order/views/create-order-view";
import { useCreateOrder } from "@/frontend/pages/order/hooks/use-create-order";

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

// A parent group: `path` is only used for collapsible state and active
// matching, so it is a plain string and never rendered as an `href`.
type NavGroup = {
    Icon: Icon;
    name: string;
    path: string;
    items: NavLink[];
    badge?: number;
};

type NavEntry = NavLink | NavGroup;

const ITEM_CLASSES = [
    "flex-none cursor-pointer rounded-full whitespace-nowrap text-sm text-secondary-foreground h-9 bg-sidebar border-none px-4 py-2",
    "hover:bg-linear-to-r/oklch from-primary from-0% via-50% via-sidebar-primary/75 to-sidebar-primary/50 hover:text-white",
    "data-active:bg-linear-to-r/oklch data-active:text-white",
    // The kit styles two more states with its own (dark) accent colour: a
    // group whose submenu is expanded being hovered, and the pressed state.
    // Both would leave the label and icon dark on the orange gradient.
    "data-open:hover:bg-linear-to-r/oklch data-open:hover:text-white active:bg-linear-to-r/oklch active:text-white",
];

function ReviewBadge({ count }: { count?: number }) {
    if (!count) return null;

    return (
        <span className="bg-primary text-primary-foreground ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums group-data-[collapsible=icon]:hidden">
            {count > 99 ? "99+" : count}
        </span>
    );
}

export function Sidenav({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
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

    const ops: NavEntry[] = [
        {
            // The group's badge counts trips stopped, flagged or in dispute;
            // the disputes page carries its own share of it
            Icon: IconBox,
            name: t("content.ops.orders.orders"),
            path: "/orders",
            badge: attention ? attention.total + attention.disputes : undefined,
            items: [
                { Icon: IconList, name: t("content.ops.orders.all"), path: "/orders/all" },
                { Icon: IconLockOpen, name: t("content.ops.orders.prospects"), path: "/orders/prospect" },
                { Icon: IconLock, name: t("content.ops.orders.booked"), path: "/orders/booked" },
                { Icon: IconTruckDelivery, name: t("content.ops.orders.on-going"), path: "/orders/on-going" },
                { Icon: IconChecks, name: t("content.ops.orders.delivered"), path: "/orders/delivered" },
                { Icon: IconHistory, name: t("content.ops.orders.history"), path: "/orders/history" },
                { Icon: IconGavel, name: t("content.ops.orders.disputes"), path: "/orders/disputes", badge: attention?.disputes },
            ],
        },
        {
            Icon: IconMap2,
            name: t("content.ops.map"),
            path: "/map",
        },
        {
            Icon: IconMessages,
            name: t("content.ops.chats"),
            path: "/chats",
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
            badge: queue ? queue.carriers + queue.drivers + queue.fleet : undefined,
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
        const hasChildren = "items" in item;
        const isActive = pathname.startsWith(item.path);

        return (
            <Collapsible
                key={item.path}
                open={openSubmenu === item.path || isActive}
                onOpenChange={(isOpen) => {
                    setOpenSubmenu(isOpen ? item.path : null)
                }}
                className="group/collapsible"
            >
                <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                            // Only use asChild when we are actually wrapping a Link component
                            asChild={!hasChildren}
                            tooltip={item.name}
                            isActive={isActive}
                            className={cn(...ITEM_CLASSES, isActive && "bg-linear-to-r/oklch border-[#E67623]/10")}
                        >
                            {"items" in item ? (
                                /* Parent UI: Just a layout, no navigation */
                                <div className="flex w-full items-center gap-2">
                                    <item.Icon className="size-5! shrink-0" stroke={1} />
                                    <span className="font-medium tracking-tight flex-1 text-left">
                                        {item.name}
                                    </span>
                                    {/* The group only shows its count while closed; open, each child carries its own */}
                                    {!(openSubmenu === item.path || isActive) && <ReviewBadge count={item.badge} />}
                                    <IconChevronRight className="ml-1 size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                </div>
                            ) : (
                                /* Leaf UI: Standard navigation link */
                                <Link href={item.path}>
                                    <item.Icon className="size-5!" stroke={1} />
                                    <span className="font-medium tracking-tight">
                                        {item.name}
                                    </span>
                                    <ReviewBadge count={item.badge} />
                                </Link>
                            )}
                        </SidebarMenuButton>
                    </CollapsibleTrigger>

                    {"items" in item && item.items.length > 0 && (
                        <CollapsibleContent>
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
                                                className={cn(...ITEM_CLASSES, "[&>svg]:text-current", isSubActive && "bg-linear-to-r/oklch border-[#E67623]/10")}
                                            >
                                                <Link href={subItem.path}>
                                                    <subItem.Icon className="size-5!" stroke={1} />
                                                    <span className="tracking-tight">
                                                        {subItem.name}
                                                    </span>
                                                    <ReviewBadge count={subItem.badge} />
                                                </Link>
                                            </SidebarMenuSubButton>
                                        </SidebarMenuSubItem>
                                    )
                                })}
                            </SidebarMenuSub>
                        </CollapsibleContent>
                    )}
                </SidebarMenuItem>
            </Collapsible>
        )
    })

    return (
        <Sidebar variant="inset" collapsible="icon" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild tooltip={g("app-name")}>
                            <Link href="/orders/all">
                                <div className="text-primary-foreground flex aspect-square size-12 items-center justify-center rounded-2xl">
                                    <Image src="/logos/logo-unlabel.svg" alt={g("app-name")} width={40} height={40} className="size-10" unoptimized />
                                </div>
                                <div className="grid flex-1 text-left text-lg leading-tight">
                                    <span className="truncate font-semibold tracking-wider">
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
                <SidebarGroup className="py-4">
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

                <SidebarSeparator />

                <SidebarGroup className="py-4">
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
