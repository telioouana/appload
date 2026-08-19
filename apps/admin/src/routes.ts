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
 * These routes will redirect logged-in users to /payments
 * @type { string[] }
 */
export const authRoutes: string[] = [
    "/sign-in",
    "/forgot-password",
    "/reset-password",
    "/2fa",
]

/**
 * The prefix for API authentication routes
 * The routes that start with this prefix are used for API authentication purposes
 * @type { string }
 */
export const apiAuthPrefix: string = "/api/auth"

export const DEFAULT_LOGIN_REDIRECT = "/orders/all"