import type { VehicleKind } from "@/frontend/pages/fleet/types";
import type { MovementRow } from "@/frontend/pages/movements/types";
import type { OrgType } from "@/frontend/pages/partners/types";

/**
 * What the ⌘K palette shows. A load is cut out of `MovementRow` rather than
 * declared field by field: the list row is the only shape a movement leaves
 * the server in, and picking from it means no money field can be added here
 * by hand later.
 */
export type SearchLoad = Pick<
    MovementRow,
    "id" | "ref" | "status" | "execution" | "role" | "origin" | "destination"
>;

export type SearchPartner = {
    /** The connection id — what the partners sheet opens on `?id=` */
    id: string;
    name: string;
    type: OrgType;
};

export type SearchDriver = {
    id: string;
    name: string;
    phone: string | null;
};

export type SearchVehicle = {
    id: string;
    kind: VehicleKind;
    plate: string;
};

export type GlobalSearch = {
    loads: SearchLoad[];
    partners: SearchPartner[];
    drivers: SearchDriver[];
    vehicles: SearchVehicle[];
};
