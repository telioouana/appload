/**
 * Self-check for the metrics fold (src/lib/metrics/orders.ts): synthetic
 * orders in, asserted months out. Pure — no database.
 *
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/verify-metrics-orders.ts
 *
 * (from apps/admin)
 */
import assert from "node:assert/strict";

import { aggregateOrders, type OrderRow } from "@/lib/metrics/orders";

const row = (overrides: Partial<OrderRow>): OrderRow => ({
    status: "delivered",
    route: "national",
    expectedLoadingDate: new Date("2026-03-10T00:00:00Z"),
    deliveries: 1,
    distance: 100,
    shipperId: "s1",
    carrierId: "c1",
    shipperCurrency: "MZN",
    shipperTotal: "1000",
    carrierTotal: "800",
    apploadCommissionTotal: "200",
    apploadCommissionVAT: "32",
    shipperDebitTotal: "0",
    shipperCreditTotal: "0",
    carrierDebitTotal: "0",
    carrierCreditTotal: "0",
    insuranceSubscriber: null,
    insuranceValue: null,
    insuranceCurrency: null,
    ...overrides,
});

const { months, parties } = aggregateOrders([
    // A debit note on the shipper raises sales and commission; a credit note lowers sales only
    row({ shipperDebitTotal: "100", shipperCreditTotal: "50", insuranceSubscriber: "appload", insuranceValue: "40", insuranceCurrency: "USD" }),
    row({ route: "regional", shipperCurrency: "USD", shipperTotal: "500", carrierTotal: "450", apploadCommissionVAT: null, shipperId: "s2", carrierId: null }),
    row({ status: "prospect", shipperTotal: null, carrierTotal: null, apploadCommissionTotal: "70", shipperId: "s3" }),
    row({ status: "cancelled", shipperId: "s4" }),
    row({ status: "underbid", shipperId: "s5" }),
    row({ expectedLoadingDate: new Date("2025-12-31T23:00:00Z"), shipperId: "s1" }),
]);

assert.deepEqual(months.map((month) => `${month.year}-${month.month}`), ["2025-12", "2026-3"]);

const march = months[1]!;

assert.deepEqual(march.trips, { national: 1, regional: 1, total: 2 });
assert.equal(march.distanceKm, 200);
assert.deepEqual(march.native.sales, { MZN: 1050, ZAR: 0, USD: 500 });
assert.deepEqual(march.native.commission, { MZN: 300, ZAR: 0, USD: 50 });
assert.deepEqual(march.native.iva, { MZN: 32, ZAR: 0, USD: 0 });
assert.deepEqual(march.native.prospects, { MZN: 70, ZAR: 0, USD: 0 });
assert.deepEqual(march.native.insurance, { MZN: 0, ZAR: 0, USD: 40 });
assert.deepEqual({ shippers: march.shippers, carriers: march.carriers }, { shippers: 2, carriers: 1 });
assert.deepEqual(parties.lifetime, { shippers: 2, carriers: 1 });
assert.deepEqual(parties.years[2026], { shippers: 2, carriers: 1 });

console.log("metrics fold: all checks passed");
