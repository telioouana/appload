/**
 * Path helpers for EdgeStore bucket prefixes.
 *
 * Deliberately free of any `@edgestore/server` or `@workspace/auth` import
 * so client components can pull it in — the folding has to happen on the
 * caller's side (see below), which is client code.
 */

/**
 * The charset EdgeStore accepts for a bucket path, copied from the 400 it
 * returns when a value falls outside it. Each `/`-separated segment must
 * start alphanumeric and continue in `[a-zA-Z0-9-_]`; the whole value may
 * be empty.
 */
export const STORAGE_PATH_RE =
    /^([a-zA-Z0-9]+[a-zA-Z0-9\-_]*(\/[a-zA-Z0-9]+[a-zA-Z0-9\-_]*)*)?$/

/**
 * Folds a prefix built from real-world data into that charset.
 *
 * This has to run at the call site rather than inside the bucket's
 * `.path()` or its zod `input`, because neither of those sees the value:
 *
 * - `.path()` is invoked once at module load with proxies whose properties
 *   return accessor strings ("input.path"). EdgeStore stores those and
 *   resolves them against the real request later, so anything computed
 *   inside the resolver runs on the string "input.path", not on the id.
 * - the `input` schema is never parsed at runtime by either
 *   `@edgestore/server` or `@edgestore/react` — it only types the
 *   `upload({ input })` argument, so a `.transform()` there is dead code.
 *
 * Order prefixes are keyed on the human order id ("APPL021.26"), whose dot
 * is outside the charset, and an illegal value fails `/request-upload` with
 * a 400 that reaches the browser as a bare "Internal server error".
 *
 * Folding also neutralises traversal: ".." becomes "--", loses its leading
 * dashes and drops out as an empty segment.
 */
export function toStoragePath(value: string): string {
    return value
        .split("/")
        .map((segment) =>
            segment
                .replace(/[^a-zA-Z0-9\-_]/g, "-")
                // A segment must *start* alphanumeric, so leading
                // separators (original or folded) are not merely legal
                // characters in the wrong place — they fail the regex
                .replace(/^[-_]+/, "")
                .slice(0, 64),
        )
        .filter((segment) => segment.length > 0)
        .join("/")
}

/**
 * Builds the prefix for one order document. Every order upload goes
 * through here so the folding can never be forgotten at one call site.
 */
export function orderDocumentPath(orderId: string, type: string): string {
    return toStoragePath(`orders/${orderId}/${type}`)
}
