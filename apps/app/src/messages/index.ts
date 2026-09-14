import baseEn from "./en.json";
import basePt from "./pt.json";

import analyticsEn from "./en/analytics.json";
import analyticsPt from "./pt/analytics.json";
import driversEn from "./en/drivers.json";
import driversPt from "./pt/drivers.json";
import fleetEn from "./en/fleet.json";
import fleetPt from "./pt/fleet.json";
import loadsEn from "./en/loads.json";
import loadsPt from "./pt/loads.json";
import mapEn from "./en/map.json";
import mapPt from "./pt/map.json";
import notificationsEn from "./en/notifications.json";
import notificationsPt from "./pt/notifications.json";
import ordersEn from "./en/orders.json";
import ordersPt from "./pt/orders.json";
import partnersEn from "./en/partners.json";
import partnersPt from "./pt/partners.json";
import quotesEn from "./en/quotes.json";
import quotesPt from "./pt/quotes.json";
import searchEn from "./en/search.json";
import searchPt from "./pt/search.json";

/**
 * The portal's message catalog is split per feature so the features can be
 * built independently: `en.json` / `pt.json` carry the shared namespaces
 * (General, App.auth, App.shell, App.settings…), and every feature owns one
 * file per locale under `en/` and `pt/`, mounted here under `App.<feature>`.
 * pt is the key source of truth (see i18n-env.d.ts); en must mirror it.
 */
export const en = {
    ...baseEn,
    App: {
        ...baseEn.App,
        analytics: analyticsEn,
        drivers: driversEn,
        fleet: fleetEn,
        loads: loadsEn,
        map: mapEn,
        notifications: notificationsEn,
        orders: ordersEn,
        partners: partnersEn,
        quotes: quotesEn,
        search: searchEn,
    },
};

export const pt = {
    ...basePt,
    App: {
        ...basePt.App,
        analytics: analyticsPt,
        drivers: driversPt,
        fleet: fleetPt,
        loads: loadsPt,
        map: mapPt,
        notifications: notificationsPt,
        orders: ordersPt,
        partners: partnersPt,
        quotes: quotesPt,
        search: searchPt,
    },
};

export type Messages = typeof pt;
