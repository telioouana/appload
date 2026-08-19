import { desc, eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js"
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization, phoneNumber, twoFactor } from "better-auth/plugins";

import { db } from "@workspace/db/db";
import { activityLog } from "@workspace/db/activity-log";
import { member as memberSchema } from "@workspace/db/schema";
import { brandedEmail, sendEmail } from "@workspace/auth/email";
import { admin as userAdmin, manager, uac, user } from "@workspace/auth/user-permissions";
import { admin as orgAdmin, driver, oac, owner, member } from "@workspace/auth/organization-permissions";

export const STAFF_EMAIL_DOMAIN = "apploadafrica.com";

// Without this, Better Auth silently falls back to http://localhost:3000 as
// its base URL and every OAuth callback and trusted-origin check breaks in
// ways that only surface at first sign-in.
if (process.env.NODE_ENV === "production" && !process.env.BETTER_AUTH_URL) {
    throw new Error("BETTER_AUTH_URL must be set in production (the app's public origin)");
}

// Google OAuth requires client credentials; fail early instead of relying on
// unsafe `as string` casts that would only error at first OAuth attempt
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set for Google OAuth");
}

// The authoritative test for who may hold a staff account. The Google
// provider's `hd` covers one sign-in route only, and a sign-up body is
// caller-controlled, so neither can be the gate on its own.
function isStaffEmail(email?: string | null): boolean {
    return typeof email === "string"
        && email.toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`);
}

// Maps the Better Auth endpoint that created the session to a sign-in
// method label for the activity log
function signInMethod(path?: string): string | null {
    if (!path) return null;
    if (path.startsWith("/sign-in/email")) return "email";
    if (path.startsWith("/callback") || path.startsWith("/sign-in/social")) return "google";
    if (path.startsWith("/two-factor")) return "2fa";
    if (path.startsWith("/phone-number")) return "phone";
    return null;
}

export const auth = betterAuth({
    appName: "Appload",
    database: drizzleAdapter(db, {
        provider: "pg"
    }),
    baseURL: {
        allowedHosts: [
            process.env.BETTER_AUTH_URL,
            ...(process.env.NODE_ENV !== "production"
                ? [
                    "http://localhost:3000",
                    "http://localhost:3001",
                    "http://localhost:3002",
                    "http://localhost:3003",
                ]
                : []),
        ]
            .filter((url): url is string => Boolean(url))
            .map(url => {
                try {
                    return new URL(url).hostname; // Strips https:// and paths, leaving just the host
                } catch {
                    return url; // Fallback if it's already a plain host
                }
            }),
        // Single fallback only: the other dev ports are covered by allowedHosts
        // above (a request's own host wins when it matches one of them).
        fallback: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    },
    trustedOrigins: [
        process.env.BETTER_AUTH_URL,
    ].filter((url): url is string => !!url),
    trustHost: true,
    // The default limiter stores counters in memory, which on serverless is
    // per-invocation and therefore no limiter at all — counters must live in
    // the database. Better Auth's sensitive-endpoint defaults (sign-in etc.)
    // stay active on top of these rules.
    rateLimit: {
        enabled: true,
        storage: "database",
        modelName: "rateLimit",
        customRules: {
            "/request-password-reset": { window: 60, max: 3 },
        },
    },
    advanced: {
        crossSubDomainCookies: {
            // Env-driven so preview deployments (*.vercel.app) keep host-only
            // cookies; set COOKIE_DOMAIN (e.g. ".appload.co.mz") only when
            // the app and its subdomains share the apex domain
            enabled: Boolean(process.env.COOKIE_DOMAIN),
            domain: process.env.COOKIE_DOMAIN ?? "",
        },
    },
    databaseHooks: {
        user: {
            create: {
                // `type` is what staff-gate.ts derives `isStaff` from, so it
                // decides access to the whole admin API. It arrives either
                // from a sign-up body or from mapProfileToUser, both of which
                // an attacker can steer — this hook is the one place that
                // cannot be. Partner accounts (driver, shipper, carrier) are
                // created deliberately by the server and pass through.
                before: async (created) => {
                    const account = created as typeof created & { type?: string };

                    if (account.type === "appload" && !isStaffEmail(account.email)) {
                        throw new APIError("FORBIDDEN", {
                            code: "STAFF_EMAIL_REQUIRED",
                            message: `Staff accounts require an @${STAFF_EMAIL_DOMAIN} address`,
                        });
                    }

                    return { data: created };
                },
            },
            update: {
                // `type` and `status` are authorization state, and Better Auth
                // exposes every additional field on POST /update-user unless it
                // is marked `input: false` — which cannot be used here, because
                // that would also strip the `type` that fleet.registerDriver
                // and mapProfileToUser legitimately supply at creation time.
                // Nothing in this app updates either field through Better Auth,
                // so any attempt to is an escalation attempt.
                before: async (changes) => {
                    const patch = changes as typeof changes & {
                        type?: unknown;
                        status?: unknown;
                    };

                    if (patch.type !== undefined || patch.status !== undefined) {
                        throw new APIError("FORBIDDEN", {
                            code: "FIELD_NOT_UPDATABLE",
                            message: "type and status cannot be changed",
                        });
                    }

                    return { data: changes };
                },
            },
        },
        session: {
            create: {
                before: async (session) => {
                    const [membership] = await db
                        .select({
                            organizationId: memberSchema.organizationId,
                        })
                        .from(memberSchema)
                        .where(eq(memberSchema.userId, session.userId))
                        .orderBy(desc(memberSchema.createdAt))
                        .limit(1)

                    const ip = session.ipAddress || "127.0.0.1";

                    let city = "Unknown";
                    let country = "Unknown";

                    // Best-effort only: this runs on the login path, so a
                    // slow or rate-limited geolocation response must never hold
                    // the sign-in hostage — hence the hard 1.5s abort
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 1_500);

                    try {
                        const geoRes = await fetch(`https://ipapi.co/${ip}/json/`, {
                            signal: controller.signal
                        });

                        if (geoRes.ok) {
                            const geoData = await geoRes.json();
                            city = geoData.city ?? "Unknown";
                            country = geoData.country_name ?? "Unknown";
                        }
                    } catch {
                        // Geolocation lookup failed, continue with defaults
                    } finally {
                        clearTimeout(timer);
                    }

                    return {
                        data: {
                            ...session,
                            activeOrganizationId: membership?.organizationId,
                            city,
                            country,
                        }
                    }
                },
                // Session creation IS login (with 2FA the session is only
                // created after TOTP verification, so one row per real
                // sign-in)
                after: async (session, ctx) => {
                    try {
                        const s = session as typeof session & {
                            city?: string;
                            country?: string;
                            activeOrganizationId?: string;
                        };

                        await db.insert(activityLog).values({
                            action: "auth.sign_in",
                            actorId: session.userId,
                            sessionId: session.id,
                            organizationId: s.activeOrganizationId ?? null,
                            ipAddress: session.ipAddress ?? null,
                            userAgent: session.userAgent ?? null,
                            city: s.city ?? null,
                            country: s.country ?? null,
                            params: { method: signInMethod(ctx?.path) },
                        });
                    } catch (error) {
                        // Logging must never break login
                        console.error("[activity-log] sign-in", error);
                    }
                },
            }
        }
    },
    hooks: {
        after: createAuthMiddleware(async (ctx) => {
            if (ctx.path !== "/sign-out") return;

            // Still populated here: the session is only destroyed by the
            // endpoint itself, and the middleware context retains it
            const signedIn = ctx.context.session;

            if (!signedIn) return;

            try {
                await db.insert(activityLog).values({
                    action: "auth.sign_out",
                    actorId: signedIn.user.id,
                    actorName: signedIn.user.name,
                    sessionId: signedIn.session.id,
                    ipAddress: signedIn.session.ipAddress ?? null,
                    userAgent: signedIn.session.userAgent ?? null,
                });
            } catch (error) {
                // Logging must never break sign-out
                console.error("[activity-log] sign-out", error);
            }
        }),
    },
    emailAndPassword: {
        enabled: true,
        autoSignIn: false,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, url }) => {
            const result = await sendEmail({
                to: [user.email],
                subject: "Reset your password",
                html: brandedEmail({
                    title: "Reset your password",
                    lines: ["A password reset was requested for your Appload account. The link below expires after one hour."],
                    ctaLabel: "Reset password",
                    ctaUrl: url,
                    disclaimer: "If you did not request this, you can safely ignore this email — your password stays unchanged.",
                }),
            });

            // Better Auth answers 200 either way (enumeration safety), so a
            // provider failure is only visible here
            if (!result.ok) {
                console.error("[auth] reset password email failed:", result.error);
            }
        },
    },
    socialProviders: {
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // The spreadsheets scope is pending Google verification; while
            // Sheets writes go through the shared service account, only
            // request basic scopes so users avoid the unverified-app screen
            scope:
                process.env.NEXT_PUBLIC_GOOGLE_SHEETS_AUTH_MODE === "service-account"
                    ? ["email", "profile"]
                    : ["email", "profile", "https://www.googleapis.com/auth/spreadsheets"],
            // Required so Google issues a refresh token, letting the server
            // refresh Sheets access tokens without re-authentication
            accessType: "offline",
            prompt: "select_account consent",
            // Maps Google OAuth profile to create staff account type. The actual
            // domain gate is enforced in user.create.before hook which validates
            // the email domain for all account creation paths.
            mapProfileToUser: () => ({ type: "appload" as const }),
        },
    },
    emailVerification: {
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url }) => {
            await sendEmail({
                to: [user.email],
                subject: "Verify your email",
                html: brandedEmail({
                    title: "Verify your email",
                    lines: ["Confirm the email address on your Appload account to finish setting it up."],
                    ctaLabel: "Verify email",
                    ctaUrl: url,
                    disclaimer: "If you did not create an Appload account, you can safely ignore this email.",
                }),
            });
        },
    },
    session: {
        cookieCache: {
            enabled: true,
            maxAge: 60 * 5 // 5 Minutes
        },
        additionalFields: {
            city: { type: "string" },
            country: { type: "string" },
        },
    },
    user: {
        changeEmail: {
            enabled: true,
            sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
                await sendEmail({
                    to: [user.email],
                    subject: "Confirm your email change",
                    html: brandedEmail({
                        title: "Confirm your email change",
                        lines: [`A request was made to change your Appload account email to ${newEmail}.`],
                        ctaLabel: "Confirm change",
                        ctaUrl: url,
                        disclaimer: "If you did not request this change, ignore this email and consider changing your password.",
                    }),
                });
            }
        },
        additionalFields: {
            type: {
                required: true,
                type: ["appload", "shipper", "carrier", "driver"]
            },
            gender: {
                required: false,
                type: ["male", "female", "other"]
            },
            status: {
                required: true,
                type: ["active", "closed"],
                defaultValue: "active"
            },
        }
    },
    plugins: [
        phoneNumber({
            sendOTP: async () => {
                // TODO: Integrate SMS service provider
                console.log("[phoneNumber] OTP send requested");
            },
            verifyOTP: async () => {
                // TODO: Integrate SMS service provider for OTP verification
                console.log("[phoneNumber] OTP verification requested");
                return false; // Return true if the OTP is valid, false otherwise
            }
        }),
        admin({
            ac: uac,
            roles: {
                admin: userAdmin,
                manager,
                user
            }
        }),
        organization({
            // The `organization` table is the authoritative carrier/shipper
            // registry, and the ops app registers partners through
            // organizations.register, which is permission-gated. Leaving the
            // plugin's own endpoint open would let any session write straight
            // into that registry beside the gate
            allowUserToCreateOrganization: false,
            organizationLimit: 1,
            ac: oac,
            roles: {
                owner,
                admin: orgAdmin,
                member,
                driver
            },
            schema: {
                organization: {
                    additionalFields: {
                        subscriptionPlan: {
                            type: ["free", "pro"],
                            required: true,
                            defaultValue: "free"
                        },
                        nuit: {
                            type: "string",
                            required: true,
                            unique: true,
                        },
                        type: {
                            required: true,
                            type: ["shipper", "carrier"]
                        },
                        status: {
                            required: true,
                            type: ["pending", "active", "closed"],
                            defaultValue: "pending"
                        },
                        email: {
                            type: "string",
                            required: true,
                        },
                        phoneNumber: {
                            type: "string",
                            required: true,
                        },
                        billingAddress: {
                            type: "json",
                            required: true,
                        },
                        physicalAddress: {
                            type: "json",
                            required: true,
                        }
                    }
                },
                invitation: {
                    additionalFields: {
                        name: {
                            type: "string",
                            required: true,
                        }
                    }
                }
            },
            sendInvitationEmail: async ({ email, inviter, invitation, organization }) => {
                const base = process.env.NEXT_PUBLIC_APP_URL;

                if (!base) {
                    throw new Error("NEXT_PUBLIC_APP_URL must be configured to send invitation emails");
                }

                await sendEmail({
                    to: [email],
                    subject: `Invitation to join ${organization.name}`,
                    html: brandedEmail({
                        title: `Join ${organization.name} on Appload`,
                        lines: [`${inviter.user.email} invited you to join ${organization.name} on Appload.`],
                        ctaLabel: "Accept the invitation",
                        ctaUrl: `${base}/accept-invitation/${invitation.id}`,
                        disclaimer: "If you were not expecting this invitation, you can safely ignore this email.",
                    }),
                });
            }
        }),
        twoFactor(),
        nextCookies(),
    ]
});

export type Auth = typeof auth
export type Session = Auth["$Infer"]["Session"]