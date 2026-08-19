import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ilike, or } from "drizzle-orm";

import { organization } from "@workspace/db/schema";
import { createTRPCRouter } from "@workspace/trpc/init";
import { authorizedProcedure } from "@workspace/trpc/permissions";

import { uniqueViolationConstraint } from "@/lib/db-errors";
import { RegisterOrganizationBaseSchema } from "@/backend/schemas/register-organization";

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
});
