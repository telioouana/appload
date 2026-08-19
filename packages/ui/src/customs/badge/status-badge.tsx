import { IconAlertTriangle, IconBan, IconCancel, IconCircleCheck, IconClock, IconCoinOff, IconContract, IconEyeExclamation, IconFileTime, IconForklift, IconHelpCircle, IconInvoice, IconNavigationPause, IconPencilMinus, IconRosetteDiscountCheck, IconRoute, IconSearch, IconShieldCheck, IconTruckDelivery, IconTruckLoading, IconUrgent, IconUserExclamation, IconX, } from "@tabler/icons-react";

import { Badge } from "@workspace/ui/components/badge";

export type OrderStatusKey = "drafted" | "prospect" | "open" | "booked" | "to-loading" | "at-loading" | "loading" | "on-route" | "at-border" | "stopped" | "issue" | "at-offloading" | "offloading" | "delivered" | "completed" | "cancelled" | "underbid" | "waiting-documents";

// Partner verification, risk and vehicle ownership. Every key here needs a
// matching --status-{key}-text/-bg pair in globals.css, in both themes.
export type KycStatusKey = "draft" | "pending-review" | "verified" | "rejected" | "expired" | "suspended";
export type RiskStatusKey = "risk-watch" | "risk-high";
export type OwnershipStatusKey = "owner-verified" | "third-party" | "unverified";

export type StatusKey = OrderStatusKey | KycStatusKey | RiskStatusKey | OwnershipStatusKey;

const statusIcons: Record<StatusKey, React.ReactNode> = {
    drafted: <IconPencilMinus size={14} />,
    prospect: <IconInvoice size={14} />,
    open: <IconClock size={14} />,
    booked: <IconContract size={14} />,
    "to-loading": <IconRoute size={14} />,
    "at-loading": <IconTruckLoading size={14} />,
    loading: <IconForklift size={14} />,
    "on-route": <IconRoute size={14} />,
    "waiting-documents": <IconFileTime size={14} />,
    stopped: <IconNavigationPause size={14} />,
    issue: <IconAlertTriangle size={14} />,
    "at-border": <IconUrgent size={14} />,
    "at-offloading": <IconTruckLoading size={14} />,
    offloading: <IconForklift size={14} />,
    delivered: <IconTruckDelivery size={14} />,
    completed: <IconRosetteDiscountCheck size={14} />,
    cancelled: <IconCancel size={14} />,
    underbid: <IconCoinOff size={14} />,

    draft: <IconPencilMinus size={14} />,
    "pending-review": <IconSearch size={14} />,
    verified: <IconCircleCheck size={14} />,
    rejected: <IconX size={14} />,
    expired: <IconFileTime size={14} />,
    suspended: <IconBan size={14} />,

    "risk-watch": <IconEyeExclamation size={14} />,
    "risk-high": <IconUserExclamation size={14} />,

    "owner-verified": <IconShieldCheck size={14} />,
    "third-party": <IconAlertTriangle size={14} />,
    unverified: <IconHelpCircle size={14} />,
};

interface Props {
    label: string
    status: StatusKey
}

export function StatusBadge({ label, status }: Props) {
    return (
        <Badge
            variant="secondary"
            className="status px-2 py-1 gap-1.5 inline-flex items-center rounded-full text-sm border-none"
            style={{
                ["--status-text" as string]: `var(--status-${status}-text)`,
                ["--status-bg" as string]: `var(--status-${status}-bg)`,
            }}
        >
            {statusIcons[status]}
            {label}
        </Badge>
    )
}

