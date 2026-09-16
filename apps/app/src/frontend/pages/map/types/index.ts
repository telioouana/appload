import type { Location } from "@workspace/db/orders";
import type { OrderStatus } from "@workspace/db/types";
import type { TrailPoint } from "@workspace/maps/types";

// The drawing contract (route DTO, trail points, poll cadences) belongs to
// the shared map kit; re-exported here so the pages keep one short import.
export type { LatLng, OrderRouteDto, TrailPoint } from "@workspace/maps/types";
export { OVERVIEW_POLL_MS, TRAIL_POLL_MS } from "@workspace/maps/types";

export type { OrderStatus };

/** The two kinds of movement the portal watches: an Appload order, or one of the company's own loads. */
export type MapEntityKind = "order" | "load";

/** The page a pin opens, in the object form the typed `Link` takes. */
export type MapEntityHref =
    | { pathname: "/appload/details/[orderId]"; params: { orderId: string } }
    | { pathname: "/orders/load/[loadId]"; params: { loadId: string } };

/**
 * One movement on the overview map, whichever kind it is. The two sources
 * are projected onto one shape so the pins, the list and the selected card
 * are written once — and so the map never carries a field only one of them
 * has. Money and the other party's leg are not on it at all.
 */
export type MapEntity = {
    kind: MapEntityKind;
    /**
     * What the pin is selected by (`?id=`) and keyed on — the load's row id,
     * or the order's "APPL…" id, which is also the key of its route and its
     * trail. Never the reference: those are per company now, so two loads can
     * read alike and an unnumbered one is "—".
     */
    id: string;
    /** What the pin is labelled with: the order id, or the load's TRP-/ORD- reference */
    ref: string;
    href: MapEntityHref;
    /** The company on the other side, when the movement has one */
    counterpartyName: string | null;
    /**
     * The order-status vocabulary, because the pin colour, the icon and the
     * badge all read it off the same `--status-*` variables. A load reaches
     * the map only while it is in progress, and is drawn in its chip's tone
     * (`movementTone`): the truck's chain is the order's, stage for stage.
     */
    status: OrderStatus;
    origin: Location;
    destination: Location;
    driverName: string | null;
    truckPlate: string | null;
    lastPosition: TrailPoint | null;
};
