import type { Profile } from "@workspace/auth/organization-permissions";

import type { OrgType } from "@workspace/trpc/tenant-gate";

/** The message key a profile reads as: Procurement sells, so a transporter calls it Comercial. */
export type ProfileKey = Profile | "commercial";

export const profileKey = <P extends Profile>(profile: P, orgType: OrgType): P | "commercial" =>
    profile === "procurement" && orgType === "carrier" ? "commercial" : profile;

// Africa/Maputo has no DST, so a fixed UTC+2 is exact. The window pickers
// are native datetime-local inputs, which carry no zone of their own: they
// are read and written as Maputo time, the zone every date on the portal is
// shown in (i18n/request.ts), whatever the browser's own zone is.
const MAPUTO_OFFSET_MS = 2 * 60 * 60 * 1000;

export const toMaputoInput = (date: Date) => new Date(date.getTime() + MAPUTO_OFFSET_MS).toISOString().slice(0, 16);

export const fromMaputoInput = (value: string) => new Date(`${value}:00+02:00`);
