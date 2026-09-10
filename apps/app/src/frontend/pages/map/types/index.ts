import type { Location } from "@workspace/db/orders";
import type { OrderStatus } from "@workspace/db/types";
import type { TrailPoint } from "@workspace/maps/types";

// The drawing contract (route DTO, trail points, poll cadences) belongs to
// the shared map kit; re-exported here so the pages keep one short import.
export type { LatLng, OrderRouteDto, TrailPoint } from "@workspace/maps/types";
export { OVERVIEW_POLL_MS, TRAIL_POLL_MS } from "@workspace/maps/types";

export type { OrderStatus };

/** The two kinds of movement the portal watches: an Appload order, or a standalone trip. */
export type MapEntityKind = "order" | "trip";

/** The page a pin opens, in the object form the typed `Link` takes. */
export type MapEntityHref =
    | { pathname: "/orders/details/[orderId]"; params: { orderId: string } }
    | { pathname: "/trips/[tripId]"; params: { tripId: string } };

/**
 * One movement on the overview map, whichever kind it is. The two sources
 * are projected onto one shape so the pins, the list and the selected card
 * are written once — and so the map never carries a field only one of them
 * has. Money and the other party's leg are not on it at all.
 */
export type MapEntity = {
    kind: MapEntityKind;
    /** Row id, and the query key of the entity's own route and trail */
    id: string;
    /** What the pin is labelled with: the order id, or "TRP-<seq>" */
    ref: string;
    href: MapEntityHref;
    /** The company on the other side, when the movement has one */
    counterpartyName: string | null;
    /**
     * The order-status vocabulary, because the pin colour, the icon and the
     * badge all read it off the same `--status-*` variables. A standalone
     * trip is drawn as "on-route": in transit is the only state that reaches
     * the map, and it is the same truck on the same road.
     */
    status: OrderStatus;
    origin: Location;
    destination: Location;
    driverName: string | null;
    truckPlate: string | null;
    lastPosition: TrailPoint | null;
};
