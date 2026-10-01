import type { ContractAllocation, ContractBasis } from "@workspace/db/contracts";
import type { Movement } from "@workspace/db/movements";
import type { CURRENCY, PriceModel } from "@workspace/db/types";

import type { ContractRole } from "@workspace/domain/contracts/access";
import { commitmentValue } from "@workspace/domain/contracts/price";
import { legSettled } from "@workspace/domain/movements/money";
import { isAskable } from "@workspace/domain/movements/status";

/**
 * The money of a multi-trip order, read from its trips: each trip keeps its
 * own legs and running totals (movements/money.ts), and this adds them up
 * from where the reader stands — what it earns, what it pays, what has
 * moved and what is still owed. Pure, so the sums are checked on their own
 * below; nothing here is stored.
 */

type Currency = (typeof CURRENCY)[number];

/** The columns a trip's money is read from. */
export type TripMoneyRow = Pick<
    Movement,
    | "organizationId" | "execution" | "status" | "contractAllocationId"
    | "sellTotal" | "sellCurrency" | "sellReceivedAmount" | "sellSettlement"
    | "buyTotal" | "buyCurrency" | "buyPaidAmount" | "buySettlement"
>;

export type OrderMoneyLine = {
    currency: Currency;
    /** The order's value at its price, null on an open-ended order or without a price */
    committed: number | null;
    /** What the reader earns: the trips' totals on its side, what has come in, what is still owed to it */
    filed: number;
    received: number;
    receivable: number;
    /** What the reader pays: the trips' totals it owes, what has gone out, what it still owes */
    payable: number;
    paid: number;
    outstanding: number;
};

export type ShareMoney = {
    allocationId: string;
    currency: Currency;
    filed: number;
    paid: number;
    outstanding: number;
};

export type OrderMoney = { lines: OrderMoneyLine[]; byShare: ShareMoney[] };

const round = (value: number) => Math.round(value * 100) / 100;
const num = (value: string | number | null) => (value === null ? 0 : Number(value));

/** A price nobody agreed to yet is owed by nobody; a settled leg owes nothing more. */
const owed = (total: number, settled: number, settlement: Movement["sellSettlement"], open: boolean) =>
    !open || legSettled(total, settlement) ? 0 : Math.max(total - settled, 0);

export function foldOrderMoney(input: {
    role: ContractRole;
    tenantId: string;
    contract: { basis: ContractBasis; committedQty: string | number | null; currency: Currency; sellPrice: PriceModel | null };
    /** The shares the reader may see (a carrier's own only) */
    shares: Pick<ContractAllocation, "id" | "shareQty" | "buyPrice">[];
    trips: TripMoneyRow[];
}): OrderMoney {
    const { role, tenantId, contract } = input;
    const lines = new Map<Currency, OrderMoneyLine>();
    const at = (currency: Currency) => {
        const line = lines.get(currency) ?? { currency, committed: null, filed: 0, received: 0, receivable: 0, payable: 0, paid: 0, outstanding: 0 };
        lines.set(currency, line);
        return line;
    };
    const shares = new Map<string, ShareMoney>();
    const shareAt = (allocationId: string, currency: Currency) => {
        const key = `${allocationId}:${currency}`;
        const share = shares.get(key) ?? { allocationId, currency, filed: 0, paid: 0, outstanding: 0 };
        shares.set(key, share);
        return share;
    };

    // The order's own value, at the reader's price: the client's for the
    // owner and the client, its share's for a carrier
    const committedQty = contract.committedQty === null ? null : Number(contract.committedQty);
    const committed = role === "carrier"
        ? input.shares.reduce<number | null>((sum, share) => {
            const value = commitmentValue(share.buyPrice, contract.basis, share.shareQty === null ? null : Number(share.shareQty));
            return value === null ? sum : (sum ?? 0) + value;
        }, null)
        : commitmentValue(contract.sellPrice, contract.basis, committedQty);
    if (committed !== null) at(contract.currency).committed = committed;

    for (const trip of input.trips) {
        if (trip.status === "cancelled") continue;

        const owned = trip.organizationId === tenantId;
        const open = !isAskable(trip.status);
        const sell = trip.sellTotal === null ? null : { total: num(trip.sellTotal), settled: num(trip.sellReceivedAmount), settlement: trip.sellSettlement, currency: trip.sellCurrency ?? contract.currency };
        const buy = trip.buyTotal === null ? null : { total: num(trip.buyTotal), settled: num(trip.buyPaidAmount), settlement: trip.buySettlement, currency: trip.buyCurrency ?? contract.currency };

        // What the reader earns on this trip, and what it pays
        const earns = role === "owner" ? (owned ? sell : null)
            : role === "carrier" ? (owned ? sell : buy)
                : null;
        const pays = role === "owner" ? (owned && trip.execution === "partner" ? buy : null)
            : role === "client" ? (owned ? null : sell)
                : null;

        if (earns) {
            const line = at(earns.currency);
            line.filed += earns.total;
            line.received += earns.settled;
            line.receivable += owed(earns.total, earns.settled, earns.settlement, open);
        }
        if (pays) {
            const line = at(pays.currency);
            line.payable += pays.total;
            line.paid += pays.settled;
            line.outstanding += owed(pays.total, pays.settled, pays.settlement, open);
            if (role === "owner" && trip.contractAllocationId) {
                const share = shareAt(trip.contractAllocationId, pays.currency);
                share.filed += pays.total;
                share.paid += pays.settled;
                share.outstanding += owed(pays.total, pays.settled, pays.settlement, open);
            }
        }
    }

    const roundLine = <T extends Record<string, unknown>>(line: T): T =>
        Object.fromEntries(Object.entries(line).map(([key, value]) => [key, typeof value === "number" ? round(value) : value])) as T;

    return {
        lines: [...lines.values()].map(roundLine).sort((a, b) => a.currency.localeCompare(b.currency)),
        byShare: [...shares.values()].map(roundLine),
    };
}

// pnpm dlx tsx packages/domain/src/contracts/money.ts — the sums on their own
if (process.argv[1]?.endsWith("money.ts")) {
    const eq = (name: string, got: unknown, want: unknown) => {
        if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    };
    const A = "owner-org";
    const B = "carrier-org";
    const trip = (over: Partial<TripMoneyRow>): TripMoneyRow => ({
        organizationId: A, execution: "partner", status: "booked", contractAllocationId: "share-b",
        sellTotal: null, sellCurrency: null, sellReceivedAmount: "0", sellSettlement: "pending",
        buyTotal: "450000", buyCurrency: "MZN", buyPaidAmount: "0", buySettlement: "pending",
        ...over,
    });
    const contract = { basis: "weight" as const, committedQty: 1000, currency: "MZN" as const, sellPrice: null };

    // The owner pays B 450 000 a trip; one trip half paid, one unpaid, one cancelled
    const owner = foldOrderMoney({
        role: "owner", tenantId: A, contract, shares: [],
        trips: [trip({ buyPaidAmount: "200000", buySettlement: "partially" }), trip({}), trip({ status: "cancelled" })],
    });
    eq("owner pays the live trips", owner.lines[0], { currency: "MZN", committed: null, filed: 0, received: 0, receivable: 0, payable: 900000, paid: 200000, outstanding: 700000 });
    eq("…and reads them per share", owner.byShare, [{ allocationId: "share-b", currency: "MZN", filed: 900000, paid: 200000, outstanding: 700000 }]);

    // The carrier is paid the same legs; a trip still out for quotes is owed by nobody yet
    const carrier = foldOrderMoney({
        role: "carrier", tenantId: B, contract, shares: [{ id: "share-b", shareQty: "600", buyPrice: { model: "per-ton", rate: 1500 } }],
        trips: [trip({ buyPaidAmount: "200000", buySettlement: "partially" }), trip({ status: "procurement" })],
    });
    eq("the carrier earns its share", carrier.lines[0], { currency: "MZN", committed: 900000, filed: 900000, received: 200000, receivable: 250000, payable: 0, paid: 0, outstanding: 0 });

    // The client pays the owner's sell leg, valued at the order's price
    const client = foldOrderMoney({
        role: "client", tenantId: "client-org",
        contract: { ...contract, sellPrice: { model: "per-ton", rate: 2000 } }, shares: [],
        trips: [trip({ sellTotal: "600000", sellCurrency: "MZN", sellReceivedAmount: "600000", sellSettlement: "completed" })],
    });
    eq("the client pays at the order's price", client.lines[0], { currency: "MZN", committed: 2000000, filed: 0, received: 0, receivable: 0, payable: 600000, paid: 600000, outstanding: 0 });
    console.log("ok");
}
