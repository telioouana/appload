import type { NextConfig } from "next"
import createNextIntlPlugin from "@workspace/i18n/plugin"

const nextConfig: NextConfig = {
    transpilePackages: ["@workspace/ui"],
}

const withNextIntl = createNextIntlPlugin()
export default withNextIntl(nextConfig)
