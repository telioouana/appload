/**
 * An array of routes that are accessible to the public
 * These routes do not require authentication
 * @type {string[]}
 */
export const publicRoutes: string[] = [
    "/"
]

/**
 * An array of routes that are used for authentication
 * These routes will redirect logged-in users to the dashboard
 * @type { string[] }
 */
export const authRoutes: string[] = [
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
]

/**
 * Routes that must answer for a signed-in and a signed-out visitor alike.
 *
 * `/verify-email` is where an account with an unverified address is sent, so
 * it cannot bounce authenticated users away; and the link in the email lands
 * on it before Better Auth has signed anyone in.
 *
 * `/accept-invitation/[id]` is the other one: the invited person may already
 * have an account (accept and switch) or not (sign up first), and the same
 * URL has to work either way.
 * @type { string[] }
 */
export const openRoutes: string[] = [
    "/verify-email",
]

/**
 * Dynamic routes with the same "open both ways" rule. Matched by prefix,
 * because the localized variants carry a parameter segment.
 * @type { string[] }
 */
export const openDynamicRoutes: string[] = [
    "/accept-invitation/[id]",
]

/**
 * The prefix for API authentication routes
 * The routes that start with this prefix are used for API authentication purposes
 * @type { string }
 */
export const apiAuthPrefix: string = "/api/auth"

export const DEFAULT_LOGIN_REDIRECT = "/dashboard"
