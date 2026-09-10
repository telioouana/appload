"use client"

import Image from "next/image"
import { useEffect } from "react";
import { type Icon, IconBox, IconBuildingWarehouse, IconChartHistogram, IconFileInvoice, IconLayoutDashboard, IconMap2, IconRoute, IconSettings, IconTruck, IconUsers } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import { Link, usePathname } from "@/i18n/navigation";

import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@workspace/ui/components/sidebar";

import { cn } from "@workspace/ui/lib/utils";

import { NavPending } from "./nav-pending";
import { NavUser } from "./nav-user";

// Whatever the typed next-intl `Link` accepts as `href`: a plain internal
// pathname for a static route, or the `{ pathname, params }` object form for
// a route with a dynamic segment (e.g. /fleet/[kind]).
type NavHref = React.ComponentProps<typeof Link>["href"];

/**
 * A rail entry: one link to one page of the portal. The two groups below are
 * the whole of it — a carrier sees two rows a shipper does not, and nothing
 * else varies.
 */
type NavEntry = {
    Icon: Icon;
    name: string;
    /** Active matching (by path prefix) and the React key */
    match: string;
    path: NavHref;
};

const ITEM_CLASSES = [
    "flex-none cursor-pointer rounded-full whitespace-nowrap text-sm text-secondary-foreground h-9 bg-sidebar border-none px-4 py-2",
    "hover:bg-linear-to-r/oklch from-primary from-0% via-50% via-sidebar-primary/75 to-sidebar-primary/50 hover:text-white",
    "data-active:bg-linear-to-r/oklch data-active:text-white",
    "data-open:hover:bg-linear-to-r/oklch data-open:hover:text-white active:bg-linear-to-r/oklch active:text-white",
];

// Heads each area of the rail in the same quiet key as the rest of it, so the
// name separates the two lists without drawing a line between them.
const SECTION_LABEL_CLASSES = "px-4 text-[11px] font-semibold tracking-wider uppercase text-sidebar-foreground/60";

export function Sidenav({
    orgType,
    ...props
}: React.ComponentProps<typeof Sidebar> & { orgType: "shipper" | "carrier" }) {
    const t = useTranslations("App.shell.sidebar")
    const g = useTranslations("General")
    const pathname = usePathname()
    const { setOpenMobile } = useSidebar()

    // On a phone the nav is a sheet laid over the page, so following a link
    // has to dismiss it — otherwise it sits on top of what it just opened.
    // Keyed on the path so every link is covered, present and future.
    useEffect(() => {
        setOpenMobile(false)
    }, [pathname, setOpenMobile])

    const work: NavEntry[] = [
        {
            // Where signing in lands and where the logo goes back to
            Icon: IconLayoutDashboard,
            name: t("work.dashboard"),
            match: "/dashboard",
            path: "/dashboard",
        },
        {
            Icon: IconBox,
            name: t("work.orders"),
            match: "/orders",
            // The two sides enter the list at different sections: a client
            // starts from everything it filed, a carrier from the requests
            // waiting on its answer. The page's own tabs move from there
            path: { pathname: "/orders/[section]", params: { section: orgType === "shipper" ? "all" : "requests" } },
        },
        { Icon: IconFileInvoice, name: t("work.quotes"), match: "/quotes", path: "/quotes" },
        { Icon: IconRoute, name: t("work.trips"), match: "/trips", path: "/trips" },
        { Icon: IconMap2, name: t("work.map"), match: "/map", path: "/map" },
    ]

    const company: NavEntry[] = [
        // Fleet and drivers are the carrier's own assets; a shipper has
        // neither, so the two rows are absent from its rail entirely
        ...(orgType === "carrier"
            ? [
                {
                    Icon: IconTruck,
                    name: t("company.fleet"),
                    match: "/fleet",
                    // The three vehicle kinds are three routes; the rail
                    // enters at the trucks one and the page's own tabs
                    // switch between them
                    path: { pathname: "/fleet/[kind]", params: { kind: "trucks" } },
                } as NavEntry,
                { Icon: IconUsers, name: t("company.drivers"), match: "/drivers", path: "/drivers" } as NavEntry,
            ]
            : []),
        { Icon: IconBuildingWarehouse, name: t("company.partners"), match: "/partners", path: "/partners" },
        { Icon: IconChartHistogram, name: t("company.analytics"), match: "/analytics", path: "/analytics" },
    ]

    const renderEntries = (entries: NavEntry[]) => entries.map((item) => {
        const isActive = pathname.startsWith(item.match);

        return (
            <SidebarMenuItem key={item.match}>
                <SidebarMenuButton
                    asChild
                    tooltip={item.name}
                    isActive={isActive}
                    className={cn(
                        ...ITEM_CLASSES,
                        isActive && "bg-linear-to-r/oklch border-[#E67623]/10",
                    )}
                >
                    <Link href={item.path}>
                        <item.Icon className="size-5!" stroke={1} />
                        <NavPending className="font-medium tracking-tight">
                            {item.name}
                        </NavPending>
                    </Link>
                </SidebarMenuButton>
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
                    <SidebarGroupLabel className={SECTION_LABEL_CLASSES}>
                        {t("work.label")}
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu className="gap-2">
                            {renderEntries(work)}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>

                <SidebarGroup>
                    <SidebarGroupLabel className={SECTION_LABEL_CLASSES}>
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
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            asChild
                            tooltip={t("settings")}
                            isActive={pathname.startsWith("/settings")}
                            className={cn(
                                ...ITEM_CLASSES,
                                pathname.startsWith("/settings") && "bg-linear-to-r/oklch border-[#E67623]/10",
                            )}
                        >
                            <Link href="/settings">
                                <IconSettings className="size-5!" stroke={1} />
                                <NavPending className="font-medium tracking-tight">
                                    {t("settings")}
                                </NavPending>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>

                <NavUser />
            </SidebarFooter>
        </Sidebar>
    )
}
