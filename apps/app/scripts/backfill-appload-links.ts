/**
 * Opens the linked loads that the Appload orders already on the books never
 * got: every order that was filed, quoted or booked before the link door
 * existed still has a shipper and a carrier, and the portal companies among
 * them should see that load in their own lists.
 *
 * It does nothing clever of its own — it finds the orders that are missing a
 * row and calls `syncApploadLinks`, the same door every order write calls, so
 * a row opened here is the row the next transition would have opened anyway.
 * Terminal orders are left alone: nobody is waiting on a load that is over.
 *
 * Dry run by default; `--yes` writes.
 *
 * Run from apps/app (the react-server condition turns `server-only` into the
 * no-op it is inside a server render; tsx is not a dependency):
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/backfill-appload-links.ts
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/backfill-appload-links.ts --yes
 */
import fs from "node:fs";

import { and, asc, eq, inArray, isNotNull, ne, notInArray } from "drizzle-orm";

import { db } from "@workspace/db/db";
import { movement } from "@workspace/db/movements";
import { order } from "@workspace/db/orders";
import { APPLOAD_ORG_ID, type OrderStatus } from "@workspace/db/types";
import { organization } from "@workspace/db/users";

import { syncApploadLinks } from "@workspace/domain/appload/link";
import { mirrorStatus } from "@workspace/domain/movements/mirror";
import { needsOrderReference } from "@workspace/domain/movements/refs";

process.env.DATABASE_URL ??= fs.readFileSync("../admin/.env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const WRITE = process.argv.includes("--yes");

/** An order nobody is waiting on any more opens nothing. */
const TERMINAL: OrderStatus[] = ["completed", "cancelled", "underbid"];

async function main() {
    const orders = await db
        .select()
        .from(order)
        .where(notInArray(order.status, TERMINAL))
        .orderBy(asc(order.createdAt));

    if (orders.length === 0) {
        console.log("no live orders at all");
        return;
    }

    // Which of the parties named on those orders can read a load in the portal
    const parties = [...new Set(orders.flatMap((row) => [row.shipperId, row.carrierId]).filter((id): id is string => Boolean(id) && id !== APPLOAD_ORG_ID))];

    const onPortal = new Set(
        (await db
            .select({ id: organization.id })
            .from(organization)
            .where(and(inArray(organization.id, parties), isNotNull(organization.portalActivatedAt))))
            .map((row) => row.id),
    );

    const names = new Map(
        (await db
            .select({ id: organization.id, name: organization.name })
            .from(organization)
            .where(inArray(organization.id, parties)))
            .map((row) => [row.id, row.name] as const),
    );

    // Every live row already linked to one of these orders, by order and company
    const linked = new Set(
        (await db
            .select({ orderId: movement.orderId, organizationId: movement.organizationId })
            .from(movement)
            .where(and(
                inArray(movement.orderId, orders.map((row) => row.id)),
                ne(movement.status, "cancelled"),
            )))
            .map((row) => `${row.orderId}:${row.organizationId}`),
    );

    const plan: { row: typeof orders[number]; sides: string[] }[] = [];

    for (const row of orders) {
        const sides: string[] = [];

        if (onPortal.has(row.shipperId) && !linked.has(`${row.id}:${row.shipperId}`)) {
            const target = mirrorStatus(row.status, "orderer", "offered");

            // What `syncOrderer` itself refuses to open a row for
            if (target && !target.unlink && target.status !== "cancelled") {
                sides.push(`orderer ${names.get(row.shipperId) ?? row.shipperId} → ${target.status}`);
            }
        }

        if (row.carrierId && onPortal.has(row.carrierId) && !linked.has(`${row.id}:${row.carrierId}`)) {
            const target = mirrorStatus(row.status, "executor", "offered");

            // Before a booking the executing side is candidates, which this
            // door does not open — only a committed order gets a row here
            if (target && needsOrderReference(target.status)) {
                sides.push(`executor ${names.get(row.carrierId) ?? row.carrierId} → ${target.status}`);
            }
        }

        if (sides.length > 0) plan.push({ row, sides });
    }

    console.log(`\n${orders.length} live orders, ${plan.length} missing a linked load\n`);

    for (const { row, sides } of plan) {
        console.log(`  ${row.orderId.padEnd(12)} ${row.status.padEnd(16)} ${sides.join("  |  ")}`);
    }

    if (plan.length === 0) return;

    if (!WRITE) {
        console.log("\ndry run — pass --yes to open these rows");
        return;
    }

    console.log("");
    let opened = 0;

    for (const { row } of plan) {
        try {
            await syncApploadLinks(db, {
                order: row,
                from: null,
                // The rig the order went out with, when it went out with one
                dispatch: Boolean(row.driverName || row.truckPlate),
            });
            opened += 1;
            console.log(`  linked ${row.orderId}`);
        } catch (error) {
            console.error(`  FAILED ${row.orderId}`, error);
        }
    }

    console.log(`\n${opened}/${plan.length} orders linked`);
}

main()
    .catch((error) => {
        console.error("\nbackfill crashed:", error);
        process.exitCode = 1;
    })
    .finally(() => process.exit(process.exitCode ?? 0));
