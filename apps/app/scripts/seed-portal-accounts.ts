/**
 * Puts the portal's test tenants on the DEV database: the client "Cliente
 * Teste Portal" (owner and a colleague) and the transporter "A.S.M.
 * Transportes" (owner and a colleague), with the ids the harnesses and
 * seed-demo.ts already name. The client is connected to A.S.M. and to the
 * logbook carriers that moved the most orders, so its partner list is not
 * empty on the first sign-in.
 *
 * Passwords are drawn here and written to seed-portal-accounts.local.json
 * (gitignored), never printed. Re-running changes nothing that exists; an
 * account that is already there keeps its password.
 *
 * Run from apps/app:
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/seed-portal-accounts.ts
 */
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { partnerConnection } from "@workspace/db/connections";
import { db } from "@workspace/db/db";
import { order } from "@workspace/db/orders";
import { account, member, organization, user } from "@workspace/db/users";

process.env.DATABASE_URL ??= fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const database = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));

if (!/dev/i.test(database)) {
    throw new Error(`refusing to seed test accounts into "${database}": the database name must say dev`);
}

const CREDENTIALS = fileURLToPath(new URL("./seed-portal-accounts.local.json", import.meta.url));
const LOGBOOK_CARRIERS = 5;

const COMPANIES = [
    {
        id: "42655a3f-0bd5-4e46-af29-9c5ee342a8aa",
        name: "Cliente Teste Portal",
        slug: "cliente-teste-portal",
        type: "shipper" as const,
        nuit: "900000001",
        email: "cliente-teste@dev.appload.local",
        phoneNumber: "+258840000001",
        people: [
            { id: "FT7QysKKfs5NKuut5i2S8Nhg6ItrwyuR", name: "Cliente Teste", email: "delivered+portal-shipper@resend.dev", role: "owner" as const },
            { id: "seed-portal-shipper-colleague", name: "Cliente Colega", email: "delivered+portal-shipper-colleague@resend.dev", role: "operations" as const },
        ],
    },
    {
        id: "9b7674e5-ea7b-416b-a199-6ca6842da718",
        name: "A.S.M. Transportes",
        slug: "asm-transportes",
        type: "carrier" as const,
        nuit: "900000002",
        email: "asm-transportes@dev.appload.local",
        phoneNumber: "+258840000002",
        people: [
            { id: "a2R9UNA2NTiEo3FS7DxlwgBFUn8EDNU6", name: "A.S.M. Transportes", email: "delivered+portal-carrier@resend.dev", role: "owner" as const },
            { id: "AM6u6fxppa9LEkRiMnMDHyrMpThmNrQy", name: "A.S.M. Colega", email: "delivered+portal-colleague@resend.dev", role: "operations" as const },
        ],
    },
];

const [CLIENT, CARRIER] = COMPANIES as [typeof COMPANIES[number], typeof COMPANIES[number]];

const credentials: Record<string, string> = fs.existsSync(CREDENTIALS) ? JSON.parse(fs.readFileSync(CREDENTIALS, "utf8")) : {};

for (const company of COMPANIES) {
    await db
        .insert(organization)
        .values({
            id: company.id,
            name: company.name,
            slug: company.slug,
            createdAt: new Date(),
            type: company.type,
            status: "active",
            nuit: company.nuit,
            email: company.email,
            phoneNumber: company.phoneNumber,
            subscriptionPlan: "business",
            portalActivatedAt: new Date(),
            ...(company.type === "carrier" && { kycStatus: "verified" as const }),
        })
        .onConflictDoNothing({ target: organization.id });

    for (const person of company.people) {
        const made = await db
            .insert(user)
            .values({ id: person.id, name: person.name, email: person.email, emailVerified: true, type: company.type, status: "active" })
            .onConflictDoNothing({ target: user.id })
            .returning({ id: user.id });

        if (made.length > 0) {
            const password = randomBytes(12).toString("base64url");

            await db.insert(account).values({
                id: crypto.randomUUID(),
                accountId: person.id,
                providerId: "credential",
                userId: person.id,
                password: await hashPassword(password),
            });
            credentials[person.email] = password;
        }

        const [membership] = await db.select({ id: member.id }).from(member).where(and(eq(member.userId, person.id), eq(member.organizationId, company.id)));

        if (!membership) {
            await db.insert(member).values({ id: crypto.randomUUID(), organizationId: company.id, userId: person.id, role: person.role, createdAt: new Date() });
        }

        console.log(`${made.length > 0 ? "created" : "exists "}  ${person.email}  (${company.name}, ${person.role})`);
    }
}

fs.writeFileSync(CREDENTIALS, `${JSON.stringify(credentials, null, 4)}\n`);

// The transporters the logbook knows best, so the list reads like a real one
const busiest = await db
    .select({ id: organization.id, name: organization.name, orders: count() })
    .from(order)
    .innerJoin(organization, eq(organization.id, order.carrierId))
    .where(and(eq(organization.type, "carrier"), isNotNull(order.carrierId)))
    .groupBy(organization.id, organization.name)
    .orderBy(desc(count()))
    .limit(LOGBOOK_CARRIERS);

for (const partner of [{ id: CARRIER.id, name: CARRIER.name }, ...busiest]) {
    // One row per pair, whoever asked: the unique index is on the sorted pair
    const made = await db
        .insert(partnerConnection)
        .values({
            requesterOrgId: CLIENT.id,
            targetOrgId: partner.id,
            relation: "client-carrier",
            status: "accepted",
            acceptedVia: "staff",
            requestedByUserId: CLIENT.people[0]!.id,
            respondedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: partnerConnection.id });

    console.log(`${made.length > 0 ? "connected" : "already  "}  ${CLIENT.name} — ${partner.name}`);
}

const [{ partners } = { partners: 0 }] = await db
    .select({ partners: count() })
    .from(partnerConnection)
    .where(and(eq(partnerConnection.requesterOrgId, CLIENT.id), eq(partnerConnection.status, "accepted"), inArray(partnerConnection.relation, ["client-carrier"])));

console.log(`\n${CLIENT.name} has ${partners} transporters as partners`);
console.log(`passwords: ${CREDENTIALS}`);

process.exit(0);
