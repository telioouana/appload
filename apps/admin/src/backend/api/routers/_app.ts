import { createTRPCRouter } from "@workspace/trpc/init"
import { registerActivityCatalog } from "@workspace/trpc/activity-log"

import { chatsRouter } from "./chats"
import { fleetRouter } from "./fleet"
import { kycRouter } from "./kyc"
import { organizationsRouter } from "./organizations"
import { activityCatalog } from "../activity-catalog"
import { orderRouter } from "@/frontend/pages/order/server/procedures";
import { ordersRouter } from "@/frontend/pages/orders/server/procedures";
import { partnersRouter } from "@/frontend/pages/partners/server/procedures";
import { settingsRouter } from "@/frontend/pages/settings/server/procedures";
import { documentsRouter } from "@/frontend/pages/order/server/documents-procedures";

// Module scope: runs on every cold start before any request is handled, so
// mutation log rows get their enriched params from the first request on
registerActivityCatalog(activityCatalog);

export const appRouter = createTRPCRouter({
    chats: chatsRouter,
    documents: documentsRouter,
    fleet: fleetRouter,
    kyc: kycRouter,
    order: orderRouter,
    orders: ordersRouter,
    organizations: organizationsRouter,
    partners: partnersRouter,
    settings: settingsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
