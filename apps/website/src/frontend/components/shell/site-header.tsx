"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { IconMenu2 } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@workspace/ui/components/sheet"

import { Link, usePathname } from "@/i18n/navigation"
import { LocaleSwitcher } from "@/frontend/components/shell/locale-switcher"
import { ThemeToggle } from "@/components/theme/theme-toggle"

const NAV_LINKS = [
    { key: "home", href: "/" },
    { key: "shipper", href: "/shipper" },
    { key: "carrier", href: "/carrier" },
    { key: "team", href: "/team" },
    { key: "faq", href: "/faq" },
] as const;

/**
 * Fixed header merged into the hero: transparent with light text while
 * floating over the dark banner, solidifying into a blurred light bar once
 * the page scrolls. Every route opens on a dark canvas, so the transparent
 * state is always legible.
 */
export function SiteHeader() {
    const t = useTranslations("navigation")
    const tHeader = useTranslations("header")
    const pathname = usePathname()
    const [scrolled, setScrolled] = useState(false)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 24)
        // Initial sync deferred a frame — setState inside the effect body
        // would cascade a render
        const frame = requestAnimationFrame(onScroll)
        window.addEventListener("scroll", onScroll, { passive: true })
        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener("scroll", onScroll)
        }
    }, [])

    const closeMenu = () => setOpen(false)
    const onCanvas = !scrolled

    return (
        <header
            className={cn(
                "fixed inset-x-0 top-0 z-50 transition-[background-color,border-color] duration-300",
                onCanvas
                    ? "border-b border-transparent bg-transparent"
                    : "border-b border-border/70 bg-background/85 shadow-[0_1px_0_0_rgb(0_0_0/0.02)] backdrop-blur-md",
            )}
        >
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
                <Link href="/" aria-label="Appload" className="shrink-0">
                    {onCanvas ? (
                        <Image src="/logo-white.svg" alt="Appload" width={128} height={36} priority className="h-8 w-auto" />
                    ) : (
                        <>
                            {/* Colored mark carries black fills — swap to the
                                white mark on dark surfaces via CSS */}
                            <Image src="/logo-black.svg" alt="Appload" width={128} height={36} priority className="h-8 w-auto dark:hidden" />
                            <Image src="/logo-white.svg" alt="Appload" width={128} height={36} className="hidden h-8 w-auto dark:block" />
                        </>
                    )}
                </Link>

                <nav className="hidden items-center gap-1 md:flex" aria-label={tHeader("menu")}>
                    {NAV_LINKS.map((link) => (
                        <Link
                            key={link.key}
                            href={link.href}
                            className={cn(
                                "rounded-3xl px-3.5 py-2 text-sm font-medium transition-colors",
                                onCanvas
                                    ? pathname === link.href
                                        ? "text-white"
                                        : "text-white/70 hover:bg-white/10 hover:text-white"
                                    : pathname === link.href
                                        ? "text-foreground"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                        >
                            {t(link.key)}
                        </Link>
                    ))}
                </nav>

                <div className="hidden items-center gap-3 md:flex">
                    <LocaleSwitcher onCanvas={onCanvas} />
                    <ThemeToggle onCanvas={onCanvas} />
                    <Button
                        asChild
                        className="bg-(--brand-red) text-white hover:bg-(--brand-red-hover)"
                    >
                        <Link href="/contact">{tHeader("get_started")}</Link>
                    </Button>
                </div>

                <div className="flex items-center gap-2 md:hidden">
                    <LocaleSwitcher onCanvas={onCanvas} />
                    <ThemeToggle onCanvas={onCanvas} />
                    <Sheet open={open} onOpenChange={setOpen}>
                        <SheetTrigger asChild>
                            <Button
                                size="icon"
                                aria-label={tHeader("menu")}
                                className={cn(
                                    "border transition-colors",
                                    onCanvas
                                        ? "border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
                                        : "border-border bg-background text-foreground hover:bg-muted",
                                )}
                            >
                                <IconMenu2 className="size-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="right" className="w-72">
                            <SheetHeader>
                                <SheetTitle>
                                    <Image src="/appload.svg" alt="Appload" width={112} height={32} className="h-7 w-auto dark:hidden" />
                                    <Image src="/logo-white.svg" alt="Appload" width={112} height={32} className="hidden h-7 w-auto dark:block" />
                                </SheetTitle>
                            </SheetHeader>
                            <nav className="flex flex-col gap-1 px-4" aria-label={tHeader("menu")}>
                                {NAV_LINKS.map((link) => (
                                    <Link
                                        key={link.key}
                                        href={link.href}
                                        onClick={closeMenu}
                                        className={cn(
                                            "rounded-2xl px-3 py-2.5 text-base font-medium transition-colors",
                                            pathname === link.href
                                                ? "bg-muted text-foreground"
                                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                        )}
                                    >
                                        {t(link.key)}
                                    </Link>
                                ))}
                                <Link
                                    href="/contact"
                                    onClick={closeMenu}
                                    className="rounded-2xl px-3 py-2.5 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                    {t("contact")}
                                </Link>
                                <Button
                                    asChild
                                    className="mt-3 bg-(--brand-red) text-white hover:bg-(--brand-red-hover)"
                                >
                                    <Link href="/contact" onClick={closeMenu}>{tHeader("get_started")}</Link>
                                </Button>
                            </nav>
                        </SheetContent>
                    </Sheet>
                </div>
            </div>
        </header>
    )
}
