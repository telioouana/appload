import { nextJsConfig } from "@workspace/eslint-config/next-js"

/** @type {import("eslint").Linter.Config} */
export default [
    ...nextJsConfig,
    {
        // Node scripts (QStash schedule provisioning) run outside the browser
        // bundle, so the Next.js browser globals do not apply to them
        files: ["scripts/**/*.mjs"],
        languageOptions: {
            globals: { process: "readonly", console: "readonly" },
        },
    },
]
