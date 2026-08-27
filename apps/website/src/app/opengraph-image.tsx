import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ImageResponse } from "next/og"

import { OG_IMAGE_ALT } from "@/lib/seo"

export const alt = OG_IMAGE_ALT
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

// One brand card shared by every page (root file conventions are inherited
// by all child segments). Bilingual tagline so a single image serves both
// locales; the visual language mirrors the dark hero canvas.
export default async function OpenGraphImage() {
    const [logo, montserrat] = await Promise.all([
        readFile(join(process.cwd(), "public", "logo-white.svg")),
        readFile(join(process.cwd(), "src", "assets", "fonts", "montserrat-bold.ttf")),
    ])

    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 48,
                    backgroundColor: "#141210",
                    backgroundImage:
                        "radial-gradient(820px 520px at 50% 16%, rgba(238,118,35,0.16), transparent)",
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={`data:image/svg+xml;base64,${logo.toString("base64")}`}
                    width={476}
                    height={124}
                    alt=""
                />
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 20,
                        fontFamily: "Montserrat",
                    }}
                >
                    <div
                        style={{
                            fontSize: 34,
                            color: "rgba(255,255,255,0.82)",
                            textAlign: "center",
                            padding: "0 120px",
                        }}
                    >
                        Mercado digital de fretes · Digital freight marketplace
                    </div>
                    <div style={{ fontSize: 26, color: "rgba(255,255,255,0.55)" }}>
                        Moçambique &amp; SADC — appload.co.mz
                    </div>
                </div>
            </div>
        ),
        {
            ...size,
            fonts: [
                { name: "Montserrat", data: montserrat, weight: 700, style: "normal" },
            ],
        },
    )
}
