"use client"

import { useTheme } from "next-themes";
import { IconDotsVertical, IconLanguage, IconLogout, IconMoon, IconSettings, IconSun } from "@tabler/icons-react";

import { LOCALE_NAMES, useLocaleSwitch } from "@/frontend/components/locale-switcher";
import type { Locale } from "@workspace/i18n";

import { authClient } from "@workspace/auth/client";
import { useTranslations } from "@workspace/i18n";
import { Link, useRouter } from "@workspace/i18n/navigation";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@workspace/ui/components/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";

export function NavUser() {
    const t = useTranslations("Admin.sidebar.user")
    const router = useRouter()
    const { isMobile } = useSidebar()
    const { theme, setTheme } = useTheme()
    const { locale, switchTo } = useLocaleSwitch()

    const { data: session, isPending } = authClient.useSession()

    if (isPending) {
        return (
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton size="lg">
                        <Skeleton className="size-8 rounded-full" />
                        <div className="grid flex-1 gap-1.5">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-3 w-32" />
                        </div>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        )
    }

    if (!session) return null

    const { user } = session
    // Fall back to the email when the profile has no name, so the avatar is
    // never an empty circle.
    const label = user.name.trim() || user.email
    const initials = label
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()

    const onSignOut = async () => {
        await authClient.signOut({
            fetchOptions: {
                onSuccess: () => router.push("/sign-in"),
            },
        })
    }

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            className="rounded-full data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            <Avatar>
                                <AvatarImage src={user.image ?? undefined} alt={label} />
                                <AvatarFallback>{initials}</AvatarFallback>
                            </Avatar>

                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-medium tracking-tight">{label}</span>
                                <span className="text-muted-foreground truncate text-xs">{user.email}</span>
                            </div>
                            <IconDotsVertical className="ml-auto size-4" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent
                        className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-xl"
                        side={isMobile ? "bottom" : "right"}
                        align="end"
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="p-0 font-normal">
                            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                <Avatar>
                                    <AvatarImage src={user.image ?? undefined} alt={label} />
                                    <AvatarFallback>{initials}</AvatarFallback>
                                </Avatar>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-medium">{label}</span>
                                    <span className="text-muted-foreground truncate text-xs">{user.email}</span>
                                </div>
                            </div>
                        </DropdownMenuLabel>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem asChild>
                            <Link href="/settings">
                                <IconSettings />
                                {t("settings")}
                            </Link>
                        </DropdownMenuItem>

                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger className="gap-2">
                                <IconSun className="size-4 dark:hidden" />
                                <IconMoon className="hidden size-4 dark:block" />
                                {t("theme.label")}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                                    <DropdownMenuRadioItem value="light">{t("theme.light")}</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="dark">{t("theme.dark")}</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="system">{t("theme.system")}</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>

                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger className="gap-2">
                                <IconLanguage className="size-4" />
                                {t("language")}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                <DropdownMenuRadioGroup value={locale} onValueChange={(value) => switchTo(value as Locale)}>
                                    {(Object.keys(LOCALE_NAMES) as Locale[]).map((code) => (
                                        <DropdownMenuRadioItem key={code} value={code}>
                                            {LOCALE_NAMES[code]}
                                        </DropdownMenuRadioItem>
                                    ))}
                                </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem variant="destructive" onClick={onSignOut}>
                            <IconLogout />
                            {t("sign-out")}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    )
}
