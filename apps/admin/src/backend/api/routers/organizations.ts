import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ilike, or } from "drizzle-orm";

import { organization } from "@workspace/db/schema";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";
import { notify } from "@workspace/domain/notifications";

import { uniqueViolationConstraint } from "@/lib/db-errors";
import { RegisterOrganizationBaseSchema, UpdateOrganizationBaseSchema } from "@/backend/schemas/register-organization";

export type OrganizationType = "shipper" | "carrier";

export type OrgOption = { id: string; name: string };

const organizationType = z.enum(["shipper", "carrier"]);

// Escape LIKE wildcards so user input matches literally
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

const slugify = (name: string) =>
    name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

export const organizationsRouter = createTRPCRouter({
    /**
     * Pre-insert uniqueness check so the register dialog can surface
     * conflicts as field-level errors before submitting.
     */
    validate: authorizedProcedure("organizations", ["read"])
        .input(z.object({
            nuit: z.string(),
            email: z.string(),
            phone: z.string(),
        }))
        .query(async ({ ctx, input }): Promise<{ hasNuit: boolean; hasEmail: boolean; hasPhone: boolean }> => {
            const matches = await ctx.db
                .select({
                    nuit: organization.nuit,
                    email: organization.email,
                    phoneNumber: organization.phoneNumber,
                })
                .from(organization)
                .where(or(
                    eq(organization.nuit, input.nuit),
                    eq(organization.email, input.email),
                    eq(organization.phoneNumber, input.phone),
                ));

            return {
                hasNuit: matches.some((row) => row.nuit === input.nuit),
                hasEmail: matches.some((row) => row.email === input.email),
                hasPhone: matches.some((row) => row.phoneNumber === input.phone),
            };
        }),

    search: authorizedProcedure("organizations", ["read"])
        .input(z.object({ type: organizationType, query: z.string() }))
        .query(async ({ ctx, input }): Promise<OrgOption[]> => {
            const trimmed = input.query.trim();
            const filters = [eq(organization.type, input.type)];

            if (trimmed) {
                filters.push(ilike(organization.name, `%${escapeLike(trimmed)}%`));
            }

            return ctx.db
                .select({ id: organization.id, name: organization.name })
                .from(organization)
                .where(and(...filters))
                .orderBy(asc(organization.name))
                .limit(10);
        }),

    register: authorizedProcedure("organizations", ["create"])
        .input(RegisterOrganizationBaseSchema.extend({ type: organizationType }))
        .mutation(async ({ ctx, input }): Promise<OrgOption> => {
            const { type, name, nuit, email, phone, billingAddress, physicalAddress } = input;
            const slug = slugify(name) || "organization";

            // Direct insert (not Better Auth's organization.create): these are
            // external companies with no app member, and organizationLimit
            // would block an admin from registering more than one
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    const [created] = await ctx.db
                        .insert(organization)
                        .values({
                            id: crypto.randomUUID(),
                            name,
                            // Retry once with a random suffix on slug collision
                            slug: attempt === 0 ? slug : `${slug}-${crypto.randomUUID().slice(0, 4)}`,
                            nuit,
                            email,
                            phoneNumber: phone,
                            billingAddress,
                            physicalAddress,
                            type,
                            createdAt: new Date(),
                        })
                        .returning({ id: organization.id, name: organization.name });

                    if (!created) {
                        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                    }

                    return created;
                } catch (error) {
                    const constraint = uniqueViolationConstraint(error);

                    if (constraint === null) {
                        throw error;
                    }

                    if (constraint.includes("nuit")) {
                        throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_NUIT" });
                    }
                    if (constraint.includes("email")) {
                        throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_EMAIL" });
                    }
                    if (constraint.includes("phone")) {
                        throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_PHONE" });
                    }
                    if (constraint.includes("slug") && attempt === 0) {
                        continue;
                    }

                    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
                }
            }

            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
        }),

    /**
     * Partial edit of a registered organization. Every field is optional so
     * the one-field "Add NUIT" popover on a list row and the full edit form
     * share one mutation; the same unique constraints as registration apply.
     */
    update: authorizedProcedure("organizations", ["update"])
        .input(z.object({ id: z.string().nonempty(), patch: UpdateOrganizationBaseSchema }))
        .mutation(async ({ ctx, input }): Promise<OrgOption> => {
            const { representee, phone, ...fields } = input.patch;
            const values: Partial<typeof organization.$inferInsert> = {};

            if (fields.name !== undefined) values.name = fields.name;
            if (fields.nuit !== undefined) values.nuit = fields.nuit;
            if (fields.email !== undefined) values.email = fields.email;
            if (phone !== undefined) values.phoneNumber = phone;
            if (fields.billingAddress !== undefined) values.billingAddress = fields.billingAddress;
            if (fields.physicalAddress !== undefined) values.physicalAddress = fields.physicalAddress;

            if (representee !== undefined) {
                const [current] = await ctx.db
                    .select({ metadata: organization.metadata })
                    .from(organization)
                    .where(eq(organization.id, input.id));

                if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

                // The column is free-form JSON shared with other writers
                // (the party sync stores the representee there too); merge
                // rather than replace so nothing else in it is lost
                values.metadata = JSON.stringify({
                    ...parseMetadata(current.metadata),
                    representee: representee || undefined,
                });
            }

            if (Object.keys(values).length === 0) {
                const [row] = await ctx.db
                    .select({ id: organization.id, name: organization.name })
                    .from(organization)
                    .where(eq(organization.id, input.id));

                if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

                return row;
            }

            try {
                const [updated] = await ctx.db
                    .update(organization)
                    .set(values)
                    .where(eq(organization.id, input.id))
                    .returning({ id: organization.id, name: organization.name });

                if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

                return updated;
            } catch (error) {
                mapOrganizationUniqueViolation(error);
            }
        }),

    /**
     * The partner's portal plan. There are no payments: ops agrees a plan
     * commercially and records it here, and the portal gates its pro
     * screens on `plan = 'pro' and (expires is null or expires > now())`.
     * Supervisory — a plan is a commercial decision, not day-to-day ops.
     */
    setSubscription: authorizedProcedure("subscription", ["update"])
        .input(z.object({
            id: z.string().nonempty(),
            plan: z.enum(["free", "pro"]),
            // Null is an open-ended subscription, not an expired one
            expiresAt: z.date().nullable(),
        }))
        .mutation(async ({ ctx, input }) => {
            const [updated] = await ctx.db
                .update(organization)
                .set({ subscriptionPlan: input.plan, subscriptionExpiresAt: input.expiresAt })
                .where(eq(organization.id, input.id))
                .returning({
                    id: organization.id,
                    name: organization.name,
                    plan: organization.subscriptionPlan,
                    expiresAt: organization.subscriptionExpiresAt,
                });

            if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "NOT_FOUND" });

            // Everyone on the partner's side hears about it; an organization
            // with nobody on the portal yet notifies nobody
            await notify(ctx.db, {
                organizationId: updated.id,
                kind: "subscription.changed",
                params: { plan: updated.plan },
                email: true,
            });

            return updated;
        }),
});

function parseMetadata(metadata: string | null): Record<string, unknown> {
    if (!metadata) return {};
    try {
        const parsed: unknown = JSON.parse(metadata);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function mapOrganizationUniqueViolation(error: unknown): never {
    const constraint = uniqueViolationConstraint(error);

    if (constraint === null) throw error;
    if (constraint.includes("nuit")) throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_NUIT" });
    if (constraint.includes("email")) throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_EMAIL" });
    if (constraint.includes("phone")) throw new TRPCError({ code: "CONFLICT", message: "DUPLICATE_PHONE" });

    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "UNKNOWN" });
}
