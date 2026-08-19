"use client"

import { useDebouncedCallback } from "@tanstack/react-pacer";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { IconCalendar, IconChevronLeft, IconChevronRight, IconLayoutGrid, IconLayoutList, IconSearch, IconX } from "@tabler/icons-react";

import { CATEGORIES, PAYMENT_STATUS } from "@workspace/db/types";

import { useFormatter, useTranslations } from "@workspace/i18n";

import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { Calendar } from "@workspace/ui/components/calendar";
import { Separator } from "@workspace/ui/components/separator";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@workspace/ui/components/input-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@workspace/ui/components/field";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";

import { cn } from "@workspace/ui/lib/utils";

import { VIEW, FILTER, OrderStatus, statusFilter } from "@/frontend/pages/orders/types";

type HeaderTypes = {
    filter: FILTER
}

const VIEWS = [
    {
        value: "list",
        Icon: IconLayoutList
    },
    {
        value: "grid",
        Icon: IconLayoutGrid
    },
] as const

const PAYMENT_BY = ["all", "shipper", "carrier"] as const

const FIRST_YEAR = 2023

// Keys match Admin.orders.header.period.month.* in the messages files
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const

// Matches react-day-picker's DateRange shape (the package is a ui-package dependency only)
type DateRange = { from: Date | undefined; to?: Date | undefined }

const parseDate = (value: string | null) => {
    if (!value) return undefined
    const date = new Date(`${value}T00:00:00`)
    return isNaN(date.getTime()) ? undefined : date
}

const toDateParam = (date: Date | undefined) =>
    date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
        : null

export function OrdersHeaderView({ filter }: HeaderTypes) {
    const [isPending, startTransition] = useTransition();
    const t = useTranslations("Admin.orders.header");
    const searchParams = useSearchParams();
    const router = useRouter();
    const f = useFormatter();
    const isMobile = useIsMobile();

    const currentYear = new Date().getFullYear()
    const currentMonth = new Date().getMonth() + 1
    // Recomputed every render, so a new year shows up on its own each January
    const years = Array.from({ length: currentYear - FIRST_YEAR + 1 }, (_, i) => String(FIRST_YEAR + i))

    const [view, setView] = useState<VIEW>((searchParams.get("view") as VIEW) ?? "list");
    const [statusValue, setStatusValue] = useState(() => {
        const urlStatus = searchParams.get("status")
        return urlStatus && (statusFilter(filter) as string[]).includes(urlStatus) ? urlStatus : "all"
    });
    const [searchValue, setSearchValue] = useState(searchParams.get("search") ?? "");
    const [category, setCategory] = useState(searchParams.get("category") ?? "");
    const [payment, setPayment] = useState(searchParams.get("payment") ?? "");
    const [paymentBy, setPaymentBy] = useState(searchParams.get("paymentBy") ?? "all");
    const [year, setYear] = useState(searchParams.get("year") ?? String(currentYear));
    const [month, setMonth] = useState(() => {
        const urlMonth = searchParams.get("month")
        if (!urlMonth) return ""
        // Month and date range are mutually exclusive — an explicit range wins
        if (searchParams.get("from") || searchParams.get("to")) return ""
        const parsed = Number(urlMonth)
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) return ""
        // Current year can only be filtered up to the current month
        const effectiveYear = Number(searchParams.get("year") ?? currentYear)
        if (effectiveYear === currentYear && parsed > currentMonth) return ""
        return urlMonth
    });
    const [dateOpen, setDateOpen] = useState(false)
    const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
        const from = parseDate(searchParams.get("from"))
        const to = parseDate(searchParams.get("to"))
        return from || to ? { from, to } : undefined
    })
    const [status] = useState<OrderStatus[]>(statusFilter(filter))
    const [atStart, setAtStart] = useState(true)
    const [atEnd, setAtEnd] = useState(true)

    const listRef = useRef<HTMLDivElement>(null)

    function updateEdges() {
        const el = listRef.current
        if (!el) return
        setAtStart(el.scrollLeft <= 0)
        setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)
    }

    function scrollStrip(dir: 1 | -1) {
        const el = listRef.current
        if (!el) return
        el.scrollBy({ left: dir * (el.clientWidth / 2), behavior: "smooth" })
    }

    useEffect(() => {
        updateEdges()
    }, [status])

    // 3. Debounced URL Sync Logic — accepts one param or a batch, applied in a single replace
    const syncUrl = useDebouncedCallback((params: { key: string; value: string | null } | Array<{ key: string; value: string | null }>) => {
        const url = new URL(window.location.href);

        for (const { key, value } of Array.isArray(params) ? params : [params]) {
            if (value && value !== "none") {
                url.searchParams.set(key, value);
            } else {
                url.searchParams.delete(key);
            }
        }

        // startTransition prevents the browser from "hanging" during the replace
        startTransition(() => {
            router.replace(url.pathname + url.search, { scroll: false });
        });
    }, { wait: 400 });

    // Params carried over from another page may be invalid here (?status= not in this filter's
    // list, ?month= beyond the current-year cap) — scrub them from the URL in one replace
    useEffect(() => {
        const scrub: Array<{ key: string; value: string | null }> = []

        const urlStatus = searchParams.get("status")
        if (urlStatus && !(status as string[]).includes(urlStatus)) {
            scrub.push({ key: "status", value: "none" })
        }

        const urlMonth = searchParams.get("month")
        if (urlMonth && urlMonth !== month) {
            scrub.push({ key: "month", value: "none" })
        }

        if (scrub.length) syncUrl(scrub)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // 4. Handlers
    function handleSearch(val: string) {
        setSearchValue(val);
        syncUrl({ key: "search", value: val });
    }

    function handleCategoryChange(val: string) {
        setCategory(val === "none" ? "" : val)
        syncUrl({ key: "category", value: val });
    }

    // Party and status travel together so the URL never carries a half-updated pair
    function handlePaymentChange(party: string, statusVal: string) {
        setPaymentBy(party)
        setPayment(statusVal === "none" ? "" : statusVal)
        syncUrl([
            { key: "paymentBy", value: party === "all" ? "none" : party },
            { key: "payment", value: statusVal },
        ]);
    }

    function handleYearChange(val: string) {
        setYear(val);
        const params = [{ key: "year", value: val === String(currentYear) ? "none" : val }]

        // Switching into the current year invalidates months beyond the current one
        if (Number(val) === currentYear && month && Number(month) > currentMonth) {
            setMonth("")
            params.push({ key: "month", value: "none" })
        }

        syncUrl(params);
    }

    // Month and date range are one "period" filter — choosing one clears the other,
    // and all three params travel in a single URL replace
    function handleMonthChange(val: string) {
        setMonth(val === "none" ? "" : val)
        setDateRange(undefined)
        syncUrl([
            { key: "month", value: val },
            { key: "from", value: null },
            { key: "to", value: null },
        ]);
    }

    function handleDateRangeChange(range: DateRange | undefined) {
        setDateRange(range);
        setMonth("")
        syncUrl([
            { key: "from", value: toDateParam(range?.from) },
            { key: "to", value: toDateParam(range?.to) },
            { key: "month", value: "none" },
        ]);
    }

    function handleViewChange(val: VIEW) {
        setView(val);
        syncUrl({ key: "view", value: val });
    }

    function handleStatusChange(val: string) {
        setStatusValue(val);
        syncUrl({ key: "status", value: val === "all" ? "none" : val })
    }

    return (
        <Card className="min-h-fit mt-4 py-4 gap-4">
            <CardHeader className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                <div>
                    <CardTitle className="font-heading font-bold text-3xl leading-normal">{t(`page.${filter}.title`)}</CardTitle>
                    <CardDescription>{t(`page.${filter}.description`)}</CardDescription>
                </div>

                <div className="flex justify-between gap-4 items-center col-span-2">
                    <div className="flex flex-1 justify-between gap-4 items-center">
                        <InputGroup >
                            <InputGroupAddon>
                                {isPending ? (
                                    <Spinner className="text-primary" />
                                ) : (
                                    <IconSearch className="text-muted-foreground" />
                                )}
                            </InputGroupAddon>

                            <InputGroupInput
                                value={searchValue}
                                onChange={(e) => handleSearch(e.target.value)}
                                placeholder={t("search")}
                            />
                        </InputGroup>

                        <div className="flex items-center gap-2">
                            {/* Mobile always renders the card grid; the toggle only exists on wider screens */}
                            {!isMobile && (
                                <Tabs value={view} onValueChange={(v) => handleViewChange(v as VIEW)}>
                                    <TabsList className="p-1 gap-2">
                                        {VIEWS.map((item) => (
                                            <TabsTrigger
                                                key={item.value}
                                                value={item.value}
                                                className={cn(
                                                    "flex-none cursor-pointer whitespace-nowrap text-sm text-secondary-foreground rounded-full h-7 bg-sidebar border-none px-4 py-2",
                                                    "hover:bg-linear-to-r/oklch from-primary from-0% via-50% via-sidebar-primary/75 to-sidebar-primary/50",
                                                    "data-active:bg-linear-to-r/oklch"
                                                )}
                                            >
                                                <item.Icon />
                                            </TabsTrigger>
                                        ))}
                                    </TabsList>
                                </Tabs>
                            )}

                            <Select value={year} onValueChange={handleYearChange}>
                                <SelectTrigger aria-label={t("year")} className="w-fit">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="end" position="popper">
                                    {years.map((y) => (
                                        <SelectItem key={y} value={y}>{y}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
                <Separator className="col-span-3" />
            </CardHeader>

            <CardContent className="flex flex-col gap-3 min-h-fit">
                <FieldGroup>
                    <FieldSet>
                        <FieldLegend>
                            <FieldTitle>{t("filters.title")}</FieldTitle>
                        </FieldLegend>

                        <FieldGroup className="flex flex-row items-center">
                            <Field>
                                <FieldLabel className="text-muted-foreground font-normal text-xs">
                                    {t("filters.category.label")}
                                </FieldLabel>
                                <Select value={category} onValueChange={handleCategoryChange}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={t("filters.category.placeholder")} />
                                    </SelectTrigger>
                                    <SelectContent position="popper">
                                        {CATEGORIES.map((item) => (
                                            <SelectItem key={item} value={item}>
                                                {t(`filters.category.options.${item}`)}
                                            </SelectItem>
                                        ))}
                                        {category && <SelectItem value="none">{t("filters.clear")}</SelectItem>}
                                    </SelectContent>
                                </Select>
                            </Field>

                            <Field>
                                <FieldLabel className="text-muted-foreground font-normal text-xs">
                                    {t("filters.payment.label")}
                                </FieldLabel>
                                <InputGroup>
                                    <InputGroupAddon>
                                        <Select value={paymentBy} onValueChange={(v) => handlePaymentChange(v, payment || "none")}>
                                            <SelectTrigger size="sm" className="border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 dark:bg-transparent px-4 text-muted-foreground">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent align="start" position="popper">
                                                {PAYMENT_BY.map((item) => (
                                                    <SelectItem key={item} value={item}>
                                                        {t(`filters.payment.by.${item}`)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </InputGroupAddon>

                                    <Select value={payment} onValueChange={(v) => handlePaymentChange(paymentBy, v)}>
                                        <SelectTrigger className="flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 dark:bg-transparent">
                                            <SelectValue placeholder={t("filters.payment.placeholder")} />
                                        </SelectTrigger>
                                        <SelectContent position="popper">
                                            {PAYMENT_STATUS.map((item) => (
                                                <SelectItem key={item} value={item}>
                                                    {t(`filters.payment.options.${item}`)}
                                                </SelectItem>
                                            ))}
                                            {payment && <SelectItem value="none">{t("filters.clear")}</SelectItem>}
                                        </SelectContent>
                                    </Select>
                                </InputGroup>
                            </Field>

                            <Field>
                                <FieldLabel className="text-muted-foreground font-normal text-xs">
                                    {t("filters.period.label")}
                                </FieldLabel>
                                <InputGroup>
                                    <InputGroupAddon>
                                        <Select value={month} onValueChange={handleMonthChange}>
                                            <SelectTrigger size="sm" className="border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 dark:bg-transparent px-4 text-muted-foreground">
                                                <SelectValue placeholder={t("filters.period.month.label")} />
                                            </SelectTrigger>
                                            <SelectContent align="start" position="popper">
                                                {MONTHS.map((key, idx) => (
                                                    <SelectItem
                                                        key={key}
                                                        value={String(idx + 1)}
                                                        disabled={Number(year) === currentYear && idx + 1 > currentMonth}
                                                    >
                                                        {t(`filters.period.month.options.${key}`)}
                                                    </SelectItem>
                                                ))}
                                                {month && <SelectItem value="none">{t("filters.clear")}</SelectItem>}
                                            </SelectContent>
                                        </Select>
                                    </InputGroupAddon>

                                    <Popover open={dateOpen} onOpenChange={setDateOpen}>
                                        <PopoverTrigger asChild>
                                            <InputGroupInput
                                                type="text"
                                                readOnly
                                                autoComplete="off"
                                                className="w-full cursor-pointer"
                                                placeholder={t("filters.period.date.placeholder")}
                                                value={dateRange?.from
                                                    ? `${f.dateTime(dateRange.from, { day: "2-digit", month: "short", year: "numeric" })}${dateRange.to ? ` - ${f.dateTime(dateRange.to, { day: "2-digit", month: "short", year: "numeric" })}` : ""}`
                                                    : ""}
                                            />
                                        </PopoverTrigger>
                                        <PopoverContent className="w-full overflow-hidden p-0" align="start">
                                            <Calendar
                                                mode="range"
                                                numberOfMonths={2}
                                                selected={dateRange}
                                                onSelect={handleDateRangeChange}
                                            />
                                        </PopoverContent>
                                    </Popover>

                                    <InputGroupAddon align="inline-end">
                                        {dateRange?.from ? (
                                            <InputGroupButton
                                                aria-label={t("filters.clear")}
                                                onClick={() => handleDateRangeChange(undefined)}
                                            >
                                                <IconX />
                                            </InputGroupButton>
                                        ) : (
                                            <InputGroupText
                                                className="cursor-pointer"
                                                onClick={() => setDateOpen(true)}
                                            >
                                                <IconCalendar />
                                            </InputGroupText>
                                        )}
                                    </InputGroupAddon>
                                </InputGroup>
                            </Field>
                        </FieldGroup>
                    </FieldSet>
                </FieldGroup>

                <Tabs value={statusValue} onValueChange={handleStatusChange} className="relative w-full px-12">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="absolute inset-y-0 left-0 z-20 my-auto touch-manipulation rounded-full"
                        disabled={atStart}
                        onClick={() => scrollStrip(-1)}
                    >
                        <IconChevronLeft />
                        <span className="sr-only">Previous</span>
                    </Button>

                    <TabsList
                        ref={listRef}
                        onScroll={updateEdges}
                        className="w-full min-w-0 justify-start overflow-x-auto overflow-y-hidden p-0 container-snap bg-transparent gap-2"
                    >
                        {(status.length > 1 ? (["all", ...status] as const) : (["all"] as const)).map((s) => (
                            <TabsTrigger
                                key={s}
                                value={s}
                                className={cn(
                                    "flex-none cursor-pointer whitespace-nowrap text-sm text-secondary-foreground rounded-full h-8 bg-muted border-none px-4 py-2",
                                    "hover:bg-linear-to-r/oklch from-primary from-0% via-50% via-sidebar-primary/75 to-sidebar-primary/50",
                                    "data-active:bg-linear-to-r/oklch"
                                )}
                            >
                                {t(`filters.status.options.${s}`)}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="absolute inset-y-0 right-0 z-20 my-auto touch-manipulation rounded-full"
                        disabled={atEnd}
                        onClick={() => scrollStrip(1)}
                    >
                        <IconChevronRight />
                        <span className="sr-only">Next</span>
                    </Button>
                </Tabs>
            </CardContent>
        </Card>
    )
}