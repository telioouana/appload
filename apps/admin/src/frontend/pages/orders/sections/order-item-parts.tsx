"use client"

import { type ComponentType, type ReactNode } from "react";

import {
    IconBuildingFactory2,
    IconBuildingWarehouse,
    IconInvoice,
    IconPhoneCall,
    IconTruckDelivery,
    IconUser
} from "@tabler/icons-react";

import { useFormatter, useTranslations } from "@workspace/i18n";

import { cn } from "@workspace/ui/lib/utils";

import type { OrderValues } from "@/frontend/pages/orders/types";
import { PaymentStatusChip } from "@/frontend/pages/orders/sections/order-item-shared";

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
 * `showPaid` is opt-in: the stacked layout is shared with the order sheet,
 * where the remaining meter alone is enough — the details page adds the
 * paid line above it.
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

function OpsItem({ icon: Icon, children, trailing }: { icon: IconType; children: ReactNode; trailing?: ReactNode }) {
    return (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{children}</span>
            {trailing}
        </span>
    );
}

/**
 * Driver, contact and rig in one line. `phoneAction` hangs a control off the
 * phone number — the details page puts copy and "open chat" there — and
 * defaults to nothing, because the order panel renders this strip too.
 */
export function OperationsStrip({ order, className, phoneAction }: {
    order: OrderValues;
    className?: string;
    phoneAction?: ReactNode;
}) {
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
            {order.driverPhoneNumber && (
                <OpsItem icon={IconPhoneCall} trailing={phoneAction}>{order.driverPhoneNumber}</OpsItem>
            )}

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
