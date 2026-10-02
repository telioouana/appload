/**
 * Puts the rows seed-demo.ts names but the logbook rebuild of appload-dev
 * does not carry: two Appload staff (an admin and a manager) and the portal
 * carrier's test driver and truck, with the ids the seed and the harnesses
 * hard-code. Idempotent: whatever is already there is left alone.
 *
 * Run from apps/app:
 *   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/seed-demo-cast.ts
 */
import fs from "node:fs";

import { db } from "@workspace/db/db";
import { driver, truck } from "@workspace/db/fleet";
import { user } from "@workspace/db/users";

process.env.DATABASE_URL ??= fs.readFileSync("../admin/.env", "utf8").match(/^DATABASE_URL=(.+)$/m)![1]!.trim();

const database = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
if (!/dev/i.test(database)) throw new Error(`refusing to seed the demo cast into "${database}"`);

const ASM_ORG = "9b7674e5-ea7b-416b-a199-6ca6842da718";

const users = await db
    .insert(user)
    .values([
        { id: "PSDV7hFkEfqKPcY8frQ8XKZj0bKH2eSc", name: "Claire", email: "ops-claire@dev.appload.local", type: "appload", role: "admin", emailVerified: true },
        { id: "BPwJV1fWTy1POgXrvnWXjKZlLzs2fzhj", name: "Raufa", email: "ops-raufa@dev.appload.local", type: "appload", role: "manager", emailVerified: true },
        { id: "seed-demo-driver", name: "Motorista Teste", email: "driver-258841112233@appload.invalid", type: "driver", phoneNumber: "+258841112233", emailVerified: false },
    ])
    .onConflictDoNothing()
    .returning({ id: user.id });

const drivers = await db
    .insert(driver)
    .values({ id: "7b8c3f9d-858d-4f61-91f6-6acf3ac926ca", userId: "seed-demo-driver", carrierId: ASM_ORG, passport: "AB1234567" })
    .onConflictDoNothing()
    .returning({ id: driver.id });

const trucks = await db
    .insert(truck)
    .values({ id: "904b7a69-6e39-40d6-86d2-60aab85377c3", carrierId: ASM_ORG, regPlate: "AAA 124 MC", brand: "Scania", model: "R450", year: 2019, type: "articulated", vin: "DEV-TRUCK-AAA124MC" })
    .onConflictDoNothing()
    .returning({ id: truck.id });

console.log(`${database}: ${users.length} users, ${drivers.length} drivers, ${trucks.length} trucks created`);
process.exit(0);
