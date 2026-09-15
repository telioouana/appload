import type { Order } from "@workspace/db/orders";
import type {
    KycDocumentStatus,
    KycDocumentType,
    OrderDispatchSubject,
    OrderStatus,
} from "@workspace/db/types";

/**
 * The one edge that is a dispatch: a booked order leaving for the loading
 * site. Everything else that lands on "at-loading" — a resume out of an
 * interrupt, an admin correcting a trip already running — is not one, and
 * must not ask for the rig, the papers or the plan again.
 */
export function isDispatchMove(from: OrderStatus, to: OrderStatus): boolean {
    return from === "booked" && to === "at-loading";
}

/**
 * Whether a STORED booked row already carries the driver and the truck,
 * and what is still missing. This is the bar for the dispatch move: a
 * trip is often booked weeks ahead of the vehicle being named, so the
 * fields are optional at booking and mandatory the moment the order is
 * dispatched to the loading site.
 *
 * Same shape as the offer check next door (./booking-readiness): pure,
 * isomorphic, guarded by the transition mutation and advertised by
 * transitionOptions, so the dialog can never offer a move the mutation
 * would refuse.
 */

export type DispatchField =
    | "truckPlate" | "truckAge"
    | "driverId" | "driverName" | "driverPhoneNumber" | "driverPassport";

// The fields themselves, plus the column the conditional rule reads
export type DispatchRow = Pick<Order, DispatchField | "route">;

// Always required before the truck is sent to load
const REQUIRED: DispatchField[] = [
    "truckPlate", "truckAge",
    "driverId", "driverName", "driverPhoneNumber",
];

const isMissing = (value: unknown) => value === undefined || value === null || value === "";

/** The still-missing fields, in form order — empty means ready to dispatch. */
export function missingForDispatch(row: DispatchRow): DispatchField[] {
    const missing = REQUIRED.filter((field) => isMissing(row[field]));

    // The passport only crosses a border on regional trips
    if (row.route === "regional" && isMissing(row.driverPassport)) {
        missing.push("driverPassport");
    }

    return missing;
}

/**
 * The papers a rig has to have on file before it may leave for the loading
 * site (D4).
 *
 * The driver proves identity with EITHER a licence or an ID card — the same
 * either/or the verification checklist states — and every vehicle on the rig
 * carries its booklet. Proof of ownership is deliberately absent: who owns
 * the truck is a reviewer's concern, and it already reaches the order as the
 * third-party flag.
 */
export const DISPATCH_DRIVER_DOCS: KycDocumentType[] = ["driver-license", "id-card"];
export const DISPATCH_VEHICLE_DOCS: KycDocumentType[] = ["vehicle-booklet"];

/** What one subject of the rig has on file, whoever loaded it. */
export type PaperSubject = {
    kind: OrderDispatchSubject;
    subjectId: string;
    /** The driver's name, or the vehicle's plate */
    label: string;
    docs: { type: KycDocumentType; status: KycDocumentStatus }[];
};

/** A subject that cannot be dispatched, and what would satisfy it. */
export type PaperGap = {
    kind: OrderDispatchSubject;
    subjectId: string;
    label: string;
    /** Any one of these closes the gap */
    needs: KycDocumentType[];
};

/** Which papers this kind of subject is asked for. */
export const dispatchDocsFor = (kind: OrderDispatchSubject): KycDocumentType[] =>
    kind === "driver" ? DISPATCH_DRIVER_DOCS : DISPATCH_VEHICLE_DOCS;

/**
 * Whether a subject's papers stand, are merely awaiting review, or are not
 * there at all (D5).
 *
 * "Present" is what the live document set holds minus the rejected rows —
 * superseded and deleted ones never reach here. A `pending` paper counts as
 * present but leaves the subject unreviewed, and an approved paper whose
 * expiry has passed still counts: expiry is a reviewer's cue, not a reason
 * to strand a truck at the gate.
 */
export function paperState(subject: PaperSubject): "missing" | "pending" | "ok" {
    const accepted = dispatchDocsFor(subject.kind);
    const present = subject.docs.filter((doc) => accepted.includes(doc.type) && doc.status !== "rejected");

    if (present.length === 0) return "missing";

    return present.some((doc) => doc.status === "approved") ? "ok" : "pending";
}

/** The subjects with nothing on file, and what each one still owes. */
export function missingPapers(subjects: PaperSubject[]): PaperGap[] {
    return subjects
        .filter((subject) => paperState(subject) === "missing")
        .map(({ kind, subjectId, label }) => ({ kind, subjectId, label, needs: dispatchDocsFor(kind) }));
}

/** The subjects whose papers are filed but nobody has looked at them yet. */
export function unreviewedPapers(subjects: PaperSubject[]): PaperSubject[] {
    return subjects.filter((subject) => paperState(subject) === "pending");
}

/**
 * Everything the dispatch move is judged on: the fields the stored row still
 * lacks, the papers the rig still owes, and the subjects whose papers are
 * only awaiting review. `fields` and `papers` both refuse the move; the
 * unreviewed ones merely flag the order.
 */
export type DispatchReadiness = {
    fields: DispatchField[];
    papers: PaperGap[];
    unreviewed: PaperSubject[];
};
