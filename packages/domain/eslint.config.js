import { config } from "@workspace/eslint-config/react-internal"

/** @type {import("eslint").Linter.Config} */
export default [
    ...config,
    {
        // The portal's own loads never go through Appload's order door. That
        // door writes order_history (which the portal's materializer tails for
        // Appload events), defers a sheet_sync row into the Google logbook,
        // runs the KYC gate that exists for Appload's liability on an Appload
        // booking, and derives Appload's commission — none of which may happen
        // to a movement. The two doors share the subscription allowance and
        // notify(), and nothing else; this keeps that mechanical rather than
        // remembered.
        files: ["src/movements/**/*.ts"],
        rules: {
            "no-restricted-imports": ["error", {
                patterns: [
                    {
                        group: ["@workspace/domain/orders/*", "../orders/*", "./orders/*"],
                        message: "movements must not go through the Appload order door — see packages/domain/src/movements/apply.ts",
                    },
                    {
                        group: ["@workspace/db/orders"],
                        importNames: ["order", "orderHistory", "orderOffer", "orderDocument", "sheetSync"],
                        message: "movements never write Appload's order tables; the enums and Location are fine to import",
                    },
                ],
            }],
        },
    },
]
