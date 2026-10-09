import { z } from "zod";

/**
 * What a company switches on or off about the portal — the modules. A module
 * is a surface the company may not need: a client with no trucks has no use
 * for Fleet, a transporter that never passes work on has no use for the
 * subcontracting doors. Switching one off hides its entry points and refuses
 * creating new rows in it; it never hides rows that already exist, and never
 * stops the company from receiving work.
 *
 * The company stores what it switched OFF (`organization.disabled_modules`):
 * null = never configured, so everything is on, and a module added later is
 * on for everybody without a migration. Only the real CEO writes it
 * (`ownerProcedure`); an acting CEO keeps their own profile and is excluded.
 */
export const MODULES = [
    // How the company works
    { id: "own-fleet", appliesTo: ["shipper", "carrier"] },
    { id: "subcontracting", appliesTo: ["carrier"] },
    // What it uses
    { id: "standing-orders", appliesTo: ["shipper", "carrier"] },
    { id: "rentals", appliesTo: ["shipper", "carrier"] },
    { id: "chats", appliesTo: ["shipper", "carrier"] },
    { id: "map", appliesTo: ["shipper", "carrier"] },
    { id: "analytics", appliesTo: ["shipper", "carrier"] },
] as const satisfies ReadonlyArray<{ id: string; appliesTo: readonly ("shipper" | "carrier")[] }>;

export type ModuleId = (typeof MODULES)[number]["id"];
export type ModuleOrgType = "shipper" | "carrier";

export const MODULE_IDS = MODULES.map((module) => module.id) as [ModuleId, ...ModuleId[]];

export const isModuleId = (value: string): value is ModuleId => (MODULE_IDS as readonly string[]).includes(value);

/** The OFF list as stored and as the CEO sends it. */
export const DisabledModulesSchema = z.array(z.enum(MODULE_IDS));

/** The modules this kind of company has at all — the settings list, the questions at registration. */
export const modulesFor = (orgType: ModuleOrgType): ModuleId[] =>
    MODULES.filter((module) => (module.appliesTo as readonly string[]).includes(orgType)).map((module) => module.id);

/**
 * The live set: everything applicable minus what is stored off. A stored
 * value that is not a list, or an id nobody knows, is ignored — garbage in
 * the column must never switch a company's product off.
 */
export function enabledModules(orgType: ModuleOrgType, disabled: unknown): ReadonlySet<ModuleId> {
    const off = new Set(Array.isArray(disabled) ? disabled.filter((id): id is ModuleId => typeof id === "string" && isModuleId(id)) : []);
    return new Set(modulesFor(orgType).filter((id) => !off.has(id)));
}

export type ModuleConflict = "NOT_APPLICABLE" | "NOTHING_LEFT_TO_MOVE";

/**
 * Why an OFF list is not legal for this kind of company, or null when it is:
 * a module the company does not have cannot be switched, and a transporter
 * with neither its own trucks nor subcontracting has nothing left to move with.
 */
export function moduleConflict(orgType: ModuleOrgType, disabled: readonly ModuleId[]): ModuleConflict | null {
    const applicable = modulesFor(orgType);
    if (disabled.some((id) => !applicable.includes(id))) return "NOT_APPLICABLE";
    if (orgType === "carrier" && disabled.includes("own-fleet") && disabled.includes("subcontracting")) return "NOTHING_LEFT_TO_MOVE";
    return null;
}

/** Pure check, client-safe — the UI and the tRPC doors agree by construction (mirrors `can`). */
export const hasModule = (modules: ReadonlySet<string> | readonly string[], id: ModuleId): boolean =>
    modules instanceof Set ? modules.has(id) : (modules as readonly string[]).includes(id);
