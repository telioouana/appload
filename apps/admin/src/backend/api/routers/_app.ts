import { createTRPCRouter } from "@workspace/trpc/init"
import { registerActivityCatalog } from "@workspace/trpc/activity-log"

import { chatsRouter } from "./chats"
import { fleetRouter } from "./fleet"
import { kycRouter } from "./kyc"
import { organizationsRouter } from "./organizations"
import { activityCatalog } from "../activity-catalog"
import { dashboardRouter } from "@/frontend/pages/dashboard/server/procedures";
import { kpisRouter } from "@/frontend/pages/kpis/server/procedures";
import { mapRouter } from "@/frontend/pages/map/server/procedures";
import { metricsRouter } from "@/frontend/pages/metrics/server/procedures";
import { orderRouter } from "@/frontend/pages/order/server/procedures";
import { ordersRouter } from "@/frontend/pages/orders/server/procedures";
import { partnersRouter } from "@/frontend/pages/partners/server/procedures";
import { disputesRouter } from "@/frontend/pages/disputes/server/procedures";
import { settingsRouter } from "@/frontend/pages/settings/server/procedures";
import { documentsRouter } from "@/frontend/pages/order/server/documents-procedures";
import { offersRouter } from "@/frontend/pages/order/server/offers-procedures";

// Module scope: runs on every cold start before any request is handled, so
// mutation log rows get their enriched params from the first request on
registerActivityCatalog(activityCatalog);

export const appRouter = createTRPCRouter({
    chats: chatsRouter,
    dashboard: dashboardRouter,
    disputes: disputesRouter,
    documents: documentsRouter,
    fleet: fleetRouter,
    kpis: kpisRouter,
    kyc: kycRouter,
    map: mapRouter,
    metrics: metricsRouter,
    offers: offersRouter,
    order: orderRouter,
    orders: ordersRouter,
    organizations: organizationsRouter,
    partners: partnersRouter,
    settings: settingsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
