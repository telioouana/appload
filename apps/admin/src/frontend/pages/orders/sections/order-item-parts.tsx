"use client"

import { useState, type ComponentType, type ReactNode } from "react";

import {
    IconArrowRight,
    IconBuildingFactory2,
    IconBuildingWarehouse,
    IconCalendar,
    IconCancel,
    IconCheck,
    IconDots,
    IconEdit,
    IconEye,
    IconFlagCheck,
    IconInvoice,
    IconMapPin,
    IconPhoneCall,
    IconRoute,
    IconTruckDelivery,
    IconUser
} from "@tabler/icons-react";

import { useFormatter, useTranslations } from "@workspace/i18n";
import { Link } from "@workspace/i18n/navigation";

import { cn } from "@workspace/ui/lib/utils";
import { Button } from "@workspace/ui/components/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";

import type { OrderValues } from "@/frontend/pages/orders/types";
import type { OrderStatus } from "@/lib/orders/transitions";
import { primaryOrderAction } from "@/frontend/pages/orders/lib/actions";
import { useCreateOrder } from "@/frontend/pages/order/hooks/use-create-order";
import { useUpdateOrder } from "@/frontend/pages/order/hooks/use-update-order";
import { TransitionDialog } from "@/frontend/pages/orders/components/transition-dialog";
import { OrderStatusBadge, PaymentStatusChip, place } from "@/frontend/pages/orders/sections/order-item-shared";

export type IconType = ComponentType<{ className?: string }>;
export type PartyKind = "shipper" | "carrier";
export type PartyLayout = "row" | "stacked";

/* ================================================================== */
/* primitives — the whole type scale lives here                        */
/* ================================================================== */

export function Label({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <span className={cn("text-[10px] font-medium uppercase leading-none tracking-wider text-muted-foreground", className)}>
            {children}
        </span>
    );
}

export function Value({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <span className={cn("text-sm font-medium leading-tight text-foreground", className)}>
            {children}
        </span>
    );
}

export function Field({
    icon: Icon,
    label,
    className,
    children
}: {
    icon: IconType;
    label: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={cn("flex min-w-0 gap-2", className)}>
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />

            <div className="flex min-w-0 flex-col gap-1.5">
                <Label>{label}</Label>
                {children}
            </div>
        </div>
    );
}

/* ================================================================== */
/* formatting                                                          */
/* ================================================================== */

export function toPercent(value: unknown): number | null {
    const parsed = typeof value === "number"
        ? value
        : Number.parseFloat(String(value ?? "").replace("%", "").trim());

    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : null;
}

/**
 * Single place where an amount becomes a string.
 * Note: Intl ignores `currency` unless `style: "currency"` is set, so the code
 * is appended explicitly — change it here and both views follow.
 */
export function useMoney() {
    const f = useFormatter();

    return (amount: unknown, currency?: string | null) =>
        `${f.number(Number(amount ?? 0), { maximumFractionDigits: 0 })} ${currency ?? "MZN"}`;
}

/* ================================================================== */
/* shipment blocks                                                     */
/* ================================================================== */

export function OrderIdentity({ order, className }: { order: OrderValues; className?: string }) {
    const tCategory = useTranslations("Admin.orders.header.filters.category.options");

    return (
        <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
            <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-base font-semibold tracking-tight text-foreground">
                    {order.orderId}
                </span>
                <OrderStatusBadge status={order.status} />
            </div>

            <p className="truncate text-xs text-muted-foreground">
                {tCategory(order.category)}
                <span className="mx-1.5 text-muted-foreground/50">·</span>
                {order.description}
            </p>
        </div>
    );
}

export function ShipmentTotal({
    order,
    align = "end",
    className
}: {
    order: OrderValues;
    align?: "start" | "end";
    className?: string;
}) {
    const f = useFormatter();
    const money = useMoney();

    return (
        <div
            className={cn(
                "flex flex-col gap-1",
                align === "end" ? "items-end" : "items-start",
                className
            )}
        >
            {order.shipperTotal !== null && (
                <span className="whitespace-nowrap text-base font-semibold tabular-nums tracking-tight text-foreground">
                    {money(order.shipperTotal, order.shipperCurrency)}
                </span>
            )}

            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                {`${f.number(Number(order.weight), { maximumFractionDigits: 1 })} ${order.weightUnit}`}
            </span>
        </div>
    );
}

export function RouteField({
    order,
    orientation = "inline",
    className
}: {
    order: OrderValues;
    orientation?: "inline" | "stacked";
    className?: string;
}) {
    const t = useTranslations("Admin.orders.data");

    return (
        <Field icon={IconRoute} label={t("labels.route")} className={className}>
            {orientation === "inline" ? (
                <div className="flex min-w-0 items-center gap-1.5">
                    <Value className="truncate">{place(order.loadingAddress)}</Value>
                    <IconArrowRight className="size-3 shrink-0 text-muted-foreground" />
                    <Value className="truncate">{place(order.offloadingAddress)}</Value>
                </div>
            ) : (
                <div className="flex min-w-0 flex-col gap-1">
                    <Value className="flex gap-x-2 truncate items-center"><IconMapPin className="size-4 text-destructive"/> {place(order.loadingAddress)}</Value>
                    <Value className="flex gap-x-2 truncate items-center"><IconFlagCheck  className="size-4 text-emerald-400"/>{place(order.offloadingAddress)}</Value>
                </div>
            )}
        </Field>
    );
}

export function LoadingDateField({ order, className }: { order: OrderValues; className?: string }) {
    const f = useFormatter();
    const t = useTranslations("Admin.orders.data");

    return (
        <Field icon={IconCalendar} label={t("labels.loading")} className={className}>
            <Value className="whitespace-nowrap">
                {f.dateTime(order.expectedLoadingDate, {
                    day: "numeric",
                    month: "short",
                    year: "numeric"
                })}
            </Value>
        </Field>
    );
}

/* ================================================================== */
/* financial party                                                     */
/* ================================================================== */

function usePartyFields(order: OrderValues, party: PartyKind) {
    const t = useTranslations("Admin.orders.data");

    if (party === "shipper") {
        return {
            icon: IconBuildingFactory2 as IconType,
            role: t("labels.shipper"),
            name: order.shipperName || t("labels.noShipper"),
            invoiceNumber: order.shipperInvoiceNumber,
            paymentStatus: order.shipperPaymentStatus,
            paidAmount: order.shipperReceivedAmount,
            paidPercentage: order.shipperReceivedPercentage,
            remainingAmount: order.shipperRemainingAmount,
            remainingPercentage: order.shipperRemainingPercentage,
            currency: order.shipperCurrency
        };
    }

    return {
        icon: IconBuildingWarehouse as IconType,
        role: t("labels.carrier"),
        name: order.carrierName || t("labels.noCarrier"),
        invoiceNumber: order.carrierInvoiceNumber,
        paymentStatus: order.carrierPaymentStatus,
        paidAmount: order.carrierPaidAmount,
        paidPercentage: order.carrierPaidPercentage,
        remainingAmount: order.carrierRemainingAmount,
        remainingPercentage: order.carrierRemainingPercentage,
        currency: order.carrierCurrency
    };
}

function PartyName({
    icon: Icon,
    role,
    name,
    className
}: {
    icon: IconType;
    role: string;
    name: string;
    className?: string;
}) {
    return (
        <div className={cn("flex min-w-0 items-center gap-2", className)}>
            <Icon className="size-4 shrink-0 text-primary" />

            <div className="flex min-w-0 flex-col gap-1">
                <Label>{role}</Label>
                <Value className="truncate">{name}</Value>
            </div>
        </div>
    );
}

function InvoiceRef({ invoiceNumber, className }: { invoiceNumber?: string | null; className?: string }) {
    const t = useTranslations("Admin.orders.data");

    return (
        <div className={cn("flex min-w-0 items-center gap-2", className)}>
            <IconInvoice
                className={cn("size-4 shrink-0", invoiceNumber ? "text-muted-foreground" : "text-muted-foreground/40")}
            />
            <span className={cn("truncate text-sm", invoiceNumber ? "text-foreground" : "text-muted-foreground/60")}>
                {invoiceNumber || t("labels.noInvoice")}
            </span>
        </div>
    );
}

/**
 * What has actually been paid on a leg. Shows the RAW percentage (not
 * `toPercent`, which clamps to 100 — an overpaid leg legitimately reads
 * above it) and cents, since proofs of payment are recorded to the cent.
 */
function PaidLine({
    party,
    paidAmount,
    paidPercentage,
    currency,
    className
}: {
    party: PartyKind;
    paidAmount: unknown;
    paidPercentage: unknown;
    currency?: string | null;
    className?: string;
}) {
    const t = useTranslations("Admin.orders.data");
    const f = useFormatter();

    const percentage = Number.parseFloat(String(paidPercentage ?? ""));

    return (
        <div className={cn("flex items-baseline justify-between gap-2", className)}>
            {/* From Appload's side: received from the shipper, paid to the carrier */}
            <Label>{t(party === "shipper" ? "labels.received" : "labels.paid")}</Label>

            <span className="text-sm font-medium tabular-nums leading-none text-foreground">
                {`${f.number(Number(paidAmount ?? 0), { maximumFractionDigits: 2 })} ${currency ?? "MZN"}`}
                {Number.isFinite(percentage) && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {`${Math.round(percentage)}%`}
                    </span>
                )}
            </span>
        </div>
    );
}

function RemainingMeter({
    party,
    role,
    remainingAmount,
    remainingPercentage,
    currency,
    className
}: {
    party: PartyKind;
    role: string;
    remainingAmount: unknown;
    remainingPercentage: unknown;
    currency?: string | null;
    className?: string;
}) {
    const t = useTranslations("Admin.orders.data");
    const money = useMoney();

    const remaining = toPercent(remainingPercentage);
    const settled = remaining === null ? 0 : 100 - remaining;
    // Overpayment is accepted (proofs above the effective total), so the
    // remaining amount can go negative; the bar clamps, the hint says why
    const overpaid = Number(remainingAmount) < 0;

    return (
        <div className={cn("flex flex-col gap-1.5", className)}>
            <div className="flex items-baseline justify-between gap-2">
                {/* "To receive" from the shipper, "to pay" to the carrier */}
                <Label>{t(party === "shipper" ? "labels.toReceive" : "labels.toPay")}</Label>

                <span className="text-sm font-medium tabular-nums leading-none text-foreground">
                    {money(remainingAmount, currency)}
                    {remaining !== null && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            {`${Math.round(remaining)}%`}
                        </span>
                    )}
                    {overpaid && (
                        <span className="ml-1.5 text-xs font-normal text-destructive">
                            {t("labels.overpaid")}
                        </span>
                    )}
                </span>
            </div>

            <div
                className="h-1 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(settled)}
                aria-label={`${role} — ${t("labels.settled")}`}
            >
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${settled}%` }} />
            </div>
        </div>
    );
}

/**
 * `showPaid` is opt-in: the stacked layout is shared with the orders grid
 * card, where the remaining meter alone is enough — the details page adds
 * the paid line above it.
 */
export function PartyBlock({
    order,
    party,
    layout,
    showPaid = false,
    className
}: {
    order: OrderValues;
    party: PartyKind;
    layout: PartyLayout;
    showPaid?: boolean;
    className?: string;
}) {
    const fields = usePartyFields(order, party);

    if (layout === "row") {
        return (
            <div className={cn("grid grid-cols-12 items-center gap-4", className)}>
                <PartyName {...fields} className="col-span-4" />

                <InvoiceRef invoiceNumber={fields.invoiceNumber} className="col-span-2" />

                <div className="col-span-2 flex justify-start">
                    <PaymentStatusChip party={party} status={fields.paymentStatus} />
                </div>

                <RemainingMeter party={party} {...fields} className="col-span-4" />
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col gap-2.5", className)}>
            <div className="flex items-start justify-between gap-2">
                <PartyName {...fields} />
                <PaymentStatusChip party={party} status={fields.paymentStatus} />
            </div>

            <InvoiceRef invoiceNumber={fields.invoiceNumber} />

            {showPaid && <PaidLine party={party} {...fields} />}

            <RemainingMeter party={party} {...fields} />
        </div>
    );
}

/* ================================================================== */
/* operations — driver, contact, vehicle                               */
/* ================================================================== */

function OpsItem({ icon: Icon, children }: { icon: IconType; children: ReactNode }) {
    return (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{children}</span>
        </span>
    );
}

export function OperationsStrip({ order, className }: { order: OrderValues; className?: string }) {
    const t = useTranslations("Admin.orders.data");

    const hasVehicle = Boolean(order.truckPlate || order.trailerPlate);
    const assigned = order.driverName || order.driverPhoneNumber || hasVehicle;

    if (!assigned) {
        return (
            <p className={cn("text-xs italic text-muted-foreground/60", className)}>
                {t("labels.noDriverAssigned")}
            </p>
        );
    }

    return (
        <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5", className)}>
            {order.driverName && <OpsItem icon={IconUser}>{order.driverName}</OpsItem>}
            {order.driverPhoneNumber && <OpsItem icon={IconPhoneCall}>{order.driverPhoneNumber}</OpsItem>}

            {hasVehicle && (
                <OpsItem icon={IconTruckDelivery}>
                    <span className="font-medium tracking-wide text-foreground/90">
                        {order.truckPlate || t("labels.noTruck")}
                    </span>

                    {order.trailerPlate && (
                        <>
                            <span className="mx-1.5 text-muted-foreground/50">+</span>
                            <span className="tracking-wide">{order.trailerPlate}</span>
                        </>
                    )}
                </OpsItem>
            )}
        </div>
    );
}

/* ================================================================== */
/* actions                                                             */
/* ================================================================== */

/**
 * Order actions, capped at 3 visible controls on every surface: the
 * details-page link, the single most relevant next step — a transition, or
 * the deal form for a prospect (shared with the details page via
 * primaryOrderAction) — and an overflow menu for the rest. The transition
 * dialog mounts lazily per item.
 */
export function OrderActions({
    order,
    orientation,
    className
}: {
    order: OrderValues;
    orientation: "vertical" | "horizontal";
    className?: string;
}) {
    const t = useTranslations("Admin.orders.data");
    const tStatus = useTranslations("Admin.orders.header.filters.status.options");
    const { onOpen } = useUpdateOrder();
    const { onEdit, onConfirm } = useCreateOrder();

    const [dialogTarget, setDialogTarget] = useState<{ open: boolean; to?: OrderStatus }>({ open: false });

    const vertical = orientation === "vertical";
    const primary = primaryOrderAction(order);
    const terminal = order.status === "completed" || order.status === "cancelled" || order.status === "underbid";
    // A prospect edits through the create-shaped form, so the
    // booked-completeness validation applies the moment it is confirmed.
    // Everything from booked onward uses the tabbed patch sheet.
    const isProspect = order.status === "prospect";

    return (
        <div
            className={cn(
                "flex gap-2",
                vertical ? "flex-col items-stretch self-start" : "flex-row items-center",
                className
            )}
        >
            {primary && (
                <Button
                    size="sm"
                    className={cn("min-w-0 shrink-0", vertical ? "w-full" : "flex-1")}
                    onClick={() =>
                        primary.kind === "confirm"
                            ? onConfirm(order)
                            : setDialogTarget({ open: true, to: primary.to })
                    }
                >
                    {/* An arrow means "advance status"; completing the deal
                        form is a different job and gets a different icon */}
                    {primary.kind === "confirm" ? <IconCheck /> : <IconArrowRight />}
                    <span className="truncate">
                        {primary.kind === "confirm" ? t("actions.confirm") : tStatus(primary.to)}
                    </span>
                </Button>
            )}

            <Button
                asChild
                size="sm"
                variant={primary ? "outline" : "default"}
                className={cn("shrink-0", vertical ? "w-full" : "flex-1")}
            >
                <Link href={{ pathname: "/orders/details/[orderId]", params: { orderId: order.orderId } }}>
                    <IconEye />
                    {t("actions.view")}
                </Link>
            </Button>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        size={vertical ? "sm" : "icon-sm"}
                        variant="outline"
                        className={cn("shrink-0", vertical && "w-full")}
                        aria-label={t("actions.more")}
                    >
                        <IconDots />
                        {vertical && t("actions.more")}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {/* Same form as Confirm, but opened on the stored status —
                        saving partial progress without being nagged is the
                        whole point of a prospect */}
                    <DropdownMenuItem onSelect={() => (isProspect ? onEdit(order) : onOpen(order))}>
                        <IconEdit />
                        {t("actions.edit")}
                    </DropdownMenuItem>
                    {!terminal && (
                        <DropdownMenuItem onSelect={() => setDialogTarget({ open: true })}>
                            <IconArrowRight />
                            {t("actions.changeStatus")}
                        </DropdownMenuItem>
                    )}
                    {!terminal && order.status !== "delivered" && (
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setDialogTarget({ open: true, to: "cancelled" })}
                        >
                            <IconCancel />
                            {t("actions.cancel")}
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            {dialogTarget.open && (
                <TransitionDialog
                    orderId={order.orderId}
                    open={dialogTarget.open}
                    initialTarget={dialogTarget.to}
                    onClose={() => setDialogTarget({ open: false })}
                />
            )}
        </div>
    );
}