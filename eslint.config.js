// Root-level ESLint flat config for the Turborepo workspace (ESLint 9).
// App/package lint rules live in each workspace's own eslint.config.js;
// this file only declares the repo-wide ignore patterns.
/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
    ],
  },
]
