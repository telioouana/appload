"use client"

import { useState } from "react";
import { type Icon, IconBox, IconBuilding, IconBuildingFactory2, IconBuildingWarehouse, IconChecks, IconChevronRight, IconHistory, IconLock, IconLockOpen, IconMessages, IconPackages, IconPlus, IconTruck, IconTruckDelivery, IconUsers } from "@tabler/icons-react";

import { routing } from "@workspace/i18n/routing";
import { useTranslations } from "@workspace/i18n";
import { Link, usePathname } from "@workspace/i18n/navigation";

import { Button } from "@workspace/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@workspace/ui/components/collapsible";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarSeparator } from "@workspace/ui/components/sidebar";

import { cn } from "@workspace/ui/lib/utils";

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
};

// A parent group: `path` is only used for collapsible state and active
// matching, so it is a plain string and never rendered as an `href`.
type NavGroup = {
    Icon: Icon;
    name: string;
    path: string;
    items: NavLink[];
};

type NavEntry = NavLink | NavGroup;

export function Sidenav({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
    const t = useTranslations("Admin.sidebar")
    const pathname = usePathname()

    const { onOpenChange } = useCreateOrder()

    const ops: NavEntry[] = [
        {
            Icon: IconBox,
            name: t("content.ops.orders.orders"),
            path: "/orders",
            items: [
                {
                    Icon: IconPackages,
                    name: t("content.ops.orders.all"),
                    path: "/orders/all",
                },
                {
                    Icon: IconLockOpen,
                    name: t("content.ops.orders.prospects"),
                    path: "/orders/prospect",
                },
                {
                    Icon: IconLock,
                    name: t("content.ops.orders.booked"),
                    path: "/orders/booked",
                },
                {
                    Icon: IconTruckDelivery,
                    name: t("content.ops.orders.on-going"),
                    path: "/orders/on-going",
                },
                {
                    Icon: IconChecks,
                    name: t("content.ops.orders.delivered"),
                    path: "/orders/delivered",
                },
                {
                    Icon: IconHistory,
                    name: t("content.ops.orders.history"),
                    path: "/orders/history",
                },
            ]
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
                },
                {
                    Icon: IconUsers,
                    name: t("content.management.carriers.drivers"),
                    path: "/carriers/drivers",
                },
                {
                    Icon: IconTruck,
                    name: t("content.management.carriers.fleets"),
                    path: "/carriers/fleets",
                }
            ]
        },
    ]

    return (
        <Sidebar variant="inset" collapsible="icon" className="shadow-lg" {...props}>
            <SidebarHeader>
                Appload
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

                            {ops.map((item) => {
                                const hasChildren = "items" in item;

                                return (
                                    <Collapsible
                                        key={item.path}
                                        open={openSubmenu === item.path || pathname.startsWith(item.path)}
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
                                                    isActive={pathname.startsWith(item.path)}
                                                    className={cn(
                                                        "flex-none cursor-pointer rounded-full whitespace-nowrap text-sm text-secondary-foreground h-9 bg-sidebar border-none px-4 py-2",
                                                        "hover:bg-linear-to-r/oklch from-primary from-0% via-50% via-sidebar-primary/75 to-sidebar-primary/50",
                                                        "data-active:bg-linear-to-r/oklch",
                                                        pathname.startsWith(item.path) && "bg-linear-to-r/oklch border-[#E67623]/10"
                                                    )}
                                                >
                                                    {"items" in item ? (
                                                        /* Parent UI: Just a layout, no navigation */
                                                        <div className="flex w-full items-center gap-2">
                                                            <item.Icon className="size-5! shrink-0" stroke={1} />
                                                            <span className="font-medium tracking-tight flex-1 text-left">
                                                                {item.name}
                                                            </span>
                                                            <IconChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                                        </div>
                                                    ) : (
                                                        /* Leaf UI: Standard navigation link */
                                                        <Link href={item.path}>
                                                            <item.Icon className="size-5!" stroke={1} />
                                                            <span className="font-medium tracking-tight">
                                                                {item.name}
                                                            </span>
                                                        </Link>
                                                    )}
                                                </SidebarMenuButton>
                                            </CollapsibleTrigger>

                                            {"items" in item && item.items.length > 0 && (
                                                <CollapsibleContent>
                                                    <SidebarMenuSub className="mx-0 border-l-0 px-0 pl-3.5">
                                                        {item.items.map((subItem) => (
                                                            <SidebarMenuSubItem key={subItem.path} className="gap-2">
                                                                <SidebarMenuSubButton
                                                                    asChild
                                                                    isActive={pathname.startsWith(subItem.path)}
                                                                    className={cn(
                                                                        "flex-none cursor-pointer rounded-full whitespace-nowrap text-sm text-secondary-foreground h-9 bg-sidebar border-none px-4 py-2",
                                                                        "hover:bg-linear-to-r/oklch from-primary from-0% via-50% via-sidebar-primary/75 to-sidebar-primary/50",
                                                                        "data-active:bg-linear-to-r/oklch",
                                                                        pathname.startsWith(subItem.path) && "bg-linear-to-r/oklch border-[#E67623]/10"
                                                                    )}
                                                                >
                                                                    <Link href={subItem.path}>
                                                                        <subItem.Icon className="size-5!" stroke={1} />
                                                                        <span className="tracking-tight">
                                                                            {subItem.name}
                                                                        </span>
                                                                    </Link>
                                                                </SidebarMenuSubButton>
                                                            </SidebarMenuSubItem>
                                                        ))}
                                                    </SidebarMenuSub>
                                                </CollapsibleContent>
                                            )}
                                        </SidebarMenuItem>
                                    </Collapsible>
                                )
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                <SidebarSeparator />

                <SidebarGroup className="py-4">
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-2">
                            {management.map((item) => {
                                const hasChildren = "items" in item;

                                return (
                                    <Collapsible
                                        key={item.path}
                                        open={openSubmenu === item.path || pathname.startsWith(item.path)}
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
                                                    isActive={pathname.startsWith(item.path)}
                                                    className={cn(
                                                        "flex-none cursor-pointer rounded-full whitespace-nowrap text-sm text-secondary-foreground h-9 bg-sidebar border-none px-4 py-2",
                                                        "hover:bg-linear-to-r/oklch from-primary from-0% via-50% via-sidebar-primary/75 to-sidebar-primary/50",
                                                        "data-active:bg-linear-to-r/oklch",
                                                        pathname.startsWith(item.path) && "bg-linear-to-r/oklch border-[#E67623]/10"
                                                    )}
                                                >
                                                    {"items" in item ? (
                                                        /* Parent UI: Just a layout, no navigation */
                                                        <div className="flex w-full items-center gap-2">
                                                            <item.Icon className="size-5! shrink-0" stroke={1} />
                                                            <span className="font-medium tracking-tight flex-1 text-left">
                                                                {item.name}
                                                            </span>
                                                            <IconChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                                        </div>
                                                    ) : (
                                                        /* Leaf UI: Standard navigation link */
                                                        <Link href={item.path}>
                                                            <item.Icon className="size-5!" stroke={1} />
                                                            <span className="font-medium tracking-tight">
                                                                {item.name}
                                                            </span>
                                                        </Link>
                                                    )}
                                                </SidebarMenuButton>
                                            </CollapsibleTrigger>

                                            {"items" in item && item.items.length > 0 && (
                                                <CollapsibleContent>
                                                    <SidebarMenuSub className="mx-0 border-l-0 px-0 pl-3.5">
                                                        {item.items.map((subItem) => (
                                                            <SidebarMenuSubItem key={subItem.path} className="gap-2">
                                                                <SidebarMenuSubButton
                                                                    asChild
                                                                    isActive={pathname.startsWith(subItem.path)}
                                                                    className={cn(
                                                                        "flex-none cursor-pointer rounded-full whitespace-nowrap text-sm text-secondary-foreground h-9 bg-sidebar border-none px-4 py-2",
                                                                        "hover:bg-linear-to-r/oklch from-primary from-0% via-50% via-sidebar-primary/75 to-sidebar-primary/50",
                                                                        "data-active:bg-linear-to-r/oklch",
                                                                        pathname.startsWith(subItem.path) && "bg-linear-to-r/oklch border-[#E67623]/10"
                                                                    )}
                                                                >
                                                                    <Link href={subItem.path}>
                                                                        <subItem.Icon className="size-5!" stroke={1} />
                                                                        <span className="tracking-tight">
                                                                            {subItem.name}
                                                                        </span>
                                                                    </Link>
                                                                </SidebarMenuSubButton>
                                                            </SidebarMenuSubItem>
                                                        ))}
                                                    </SidebarMenuSub>
                                                </CollapsibleContent>
                                            )}
                                        </SidebarMenuItem>
                                    </Collapsible>
                                )
                            })}
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
