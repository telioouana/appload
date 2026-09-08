import type { NextConfig } from "next"
import createNextIntlPlugin from "@workspace/i18n/plugin"

const nextConfig: NextConfig = {
    transpilePackages: ["@workspace/ui"],
    experimental: {
        // Going back to a page seen in the last half minute reuses its
        // payload — the window React Query keeps the data behind it fresh for
        staleTimes: { dynamic: 30 },
    },
}

const withNextIntl = createNextIntlPlugin()
export default withNextIntl(nextConfig)
