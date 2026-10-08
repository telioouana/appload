import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * What a portal member may do, one permission per line of the profiles
 * matrix (docs: perfis-e-permissoes-portal-v2.pdf). A person's profile is
 * only where their permissions start: the people above them switch single
 * permissions on or off, for good or for a window (member_permission), and
 * the gate resolves the result on every request (`effectiveAccess`).
 */
export const PERMISSION_STATEMENTS = {
    // Money: a load's price, the company's books, and moving money
    price: ["read"],
    finance: ["read"],
    payment: ["record"],
    // Orders: placing them, answering for them, and the paper they print as
    order: ["create", "update", "cancel", "pdf"],
    // Answering a client's quote or offer (create), deciding on one (update)
    offer: ["create", "update"],
    // A trip on the company's own trucks, which carries no price
    trip: ["create"],
    dispatch: ["assign"],
    status: ["change"],
    document: ["upload", "approve"],
    dispute: ["open", "resolve"],
    // Multi-trip orders and rentals: their terms (manage), the day's trips (file)
    contract: ["manage", "file"],
    rental: ["checkin"],
    partner: ["manage"],
    // The analytics page and the partners' KPIs; money on it is `finance`
    report: ["read"],
    fleet: ["manage"],
    kyc: ["upload"],
    thread: ["read", "send"],
    export: ["csv"],
    // The company itself
    organization: ["update"],
    team: ["manage"],
    security: ["manage"],
    subscription: ["read"],
} as const;

type Statements = typeof PERMISSION_STATEMENTS;
export type OrgResource = keyof Statements;
export type OrgAction<R extends OrgResource> = Statements[R][number];
export type Permission = { [R in OrgResource]: `${R}:${OrgAction<R>}` }[OrgResource];

export const PERMISSIONS = (Object.entries(PERMISSION_STATEMENTS) as [OrgResource, readonly string[]][])
    .flatMap(([resource, actions]) => actions.map((action) => `${resource}:${action}` as Permission));

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);
export const isPermission = (value: string): value is Permission => PERMISSION_SET.has(value);

/** The matrix's sections, in its order: what the permissions sheet draws. */
export const PERMISSION_GROUPS: ReadonlyArray<{ id: string; permissions: readonly Permission[] }> = [
    { id: "money", permissions: ["price:read", "finance:read", "payment:record"] },
    {
        id: "orders",
        permissions: [
            "order:create", "offer:create", "offer:update", "order:update", "order:cancel",
            "dispatch:assign", "status:change", "document:upload", "document:approve",
            "trip:create", "dispute:open", "dispute:resolve",
        ],
    },
    { id: "contracts", permissions: ["contract:manage", "contract:file", "rental:checkin"] },
    { id: "partners", permissions: ["partner:manage", "report:read"] },
    { id: "fleet", permissions: ["fleet:manage", "kyc:upload"] },
    { id: "tools", permissions: ["thread:read", "thread:send", "export:csv", "order:pdf"] },
    { id: "company", permissions: ["organization:update", "team:manage", "security:manage", "subscription:read"] },
];

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** `member.role` values. `procurement` reads as Comercial to a transporter. */
export const PROFILES = ["owner", "admin", "procurement", "operations"] as const;
export type Profile = (typeof PROFILES)[number];

export const isProfile = (value: string): value is Profile => (PROFILES as readonly string[]).includes(value);

/** Who may edit whom: only people of a lower level than one's own. */
export const PROFILE_LEVEL: Record<Profile, 1 | 2 | 3> = {
    owner: 3,
    admin: 2,
    procurement: 1,
    operations: 1,
};

const COMPANY_ONLY: readonly Permission[] = ["organization:update", "security:manage"];

export const PROFILE_DEFAULTS: Record<Profile, readonly Permission[]> = {
    owner: PERMISSIONS,
    // Everything but the company's own profile and its security; team
    // management reaches only the level below (PROFILE_LEVEL)
    admin: PERMISSIONS.filter((permission) => !COMPANY_ONLY.includes(permission)),
    // Buys (a client) or sells (a transporter) the transport: prices yes,
    // the books no, and the load's progress is somebody else's
    procurement: [
        "price:read",
        "order:create", "order:update", "order:pdf",
        "offer:create", "offer:update",
        "trip:create", "dispute:open",
        "contract:manage", "contract:file",
        "partner:manage", "report:read",
        "thread:read", "thread:send",
    ],
    // Runs the loads: trucks, drivers, papers and status — no price anywhere
    operations: [
        "trip:create", "dispatch:assign", "status:change",
        "document:upload", "document:approve", "dispute:open",
        "contract:file", "rental:checkin",
        "fleet:manage", "kyc:upload",
        "thread:read", "thread:send",
    ],
};

/** A legacy or unknown `member.role` reads as the profile it was migrated to. */
export const profileOf = (role: string | null | undefined): Profile => {
    const first = role?.split(",")[0]?.trim() ?? "";
    if (isProfile(first)) return first;
    return "operations";
};

// ---------------------------------------------------------------------------
// Per-person changes
// ---------------------------------------------------------------------------

/**
 * One member_permission row as the resolver needs it: a permission switched
 * on or off against the profile, or the acting-CEO lift. A row counts only
 * inside its window and only until it is revoked.
 */
export type PermissionChange = {
    kind: "grant" | "remove" | "acting_owner";
    permission: string | null;
    startsAt: Date;
    endsAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
};

export const isLive = (change: Pick<PermissionChange, "startsAt" | "endsAt" | "revokedAt">, now: Date): boolean =>
    change.revokedAt === null && change.startsAt <= now && (change.endsAt === null || change.endsAt > now);

export type EffectiveAccess = {
    profile: Profile;
    /** 3 while an acting-CEO lift is live, whatever the profile */
    level: 1 | 2 | 3;
    actingOwner: boolean;
    permissions: ReadonlySet<Permission>;
};

/**
 * The profile's defaults, plus live grants, minus live removals. The CEO's
 * own set can never be reduced, and an acting CEO holds all of it for the
 * window. Pure, so the server gate and the permissions sheet agree.
 */
export function effectiveAccess(profile: Profile, changes: readonly PermissionChange[], now: Date = new Date()): EffectiveAccess {
    const live = changes.filter((change) => isLive(change, now));
    const actingOwner = profile !== "owner" && live.some((change) => change.kind === "acting_owner");

    if (profile === "owner" || actingOwner) {
        return { profile, level: 3, actingOwner, permissions: new Set(PERMISSIONS) };
    }

    const permissions = new Set<Permission>(PROFILE_DEFAULTS[profile]);
    // Oldest first, so a later change to the same permission wins
    for (const change of [...live].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
        if (!change.permission || !isPermission(change.permission)) continue;
        if (change.kind === "grant") permissions.add(change.permission);
        if (change.kind === "remove") permissions.delete(change.permission);
    }

    return { profile, level: PROFILE_LEVEL[profile], actingOwner: false, permissions };
}

/**
 * Pure permission check. Client-safe: the tRPC gates and the UI's buttons
 * both call it with the member's resolved set, so the two can never disagree.
 */
export function isOrgAuthorized<R extends OrgResource>(
    permissions: ReadonlySet<string> | readonly string[],
    resource: R,
    actions: OrgAction<R>[],
): boolean {
    const set = permissions instanceof Set ? permissions : new Set(permissions as readonly string[]);
    return actions.every((action) => set.has(`${resource}:${action}`));
}

export const can = (permissions: ReadonlySet<string> | readonly string[], permission: Permission): boolean =>
    permissions instanceof Set ? permissions.has(permission) : (permissions as readonly string[]).includes(permission);

/**
 * What a reader may see of the money on a load: nothing, the price alone,
 * or the price and the company's books around it.
 */
export type MoneyView = "none" | "prices" | "full";

export const moneyView = (permissions: ReadonlySet<string> | readonly string[]): MoneyView =>
    !can(permissions, "price:read") ? "none" : can(permissions, "finance:read") ? "full" : "prices";

// ---------------------------------------------------------------------------
// Better Auth
// ---------------------------------------------------------------------------

/**
 * The organization plugin still owns invitations, so it needs the profile
 * names as roles. It is handed nothing but inviting and cancelling, for the
 * two levels that manage a team — and the organization hooks (server.ts)
 * hold every invitation to the level rule and the inviter's live
 * `team:manage`. Changing a profile or removing someone goes through the
 * portal's own team router, never the plugin's endpoints.
 */
export const oac = createAccessControl(defaultStatements);

const inviter = oac.newRole({ invitation: ["create", "cancel"] });
const plain = oac.newRole({});

export const ORG_ROLES = {
    owner: inviter,
    admin: inviter,
    procurement: plain,
    operations: plain,
} as const;
