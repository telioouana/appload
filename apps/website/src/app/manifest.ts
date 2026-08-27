import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Appload",
        short_name: "Appload",
        description: "Digital freight marketplace for Mozambique and SADC",
        start_url: "/",
        display: "browser",
        background_color: "#141210",
        theme_color: "#141210",
        icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }],
    }
}
