import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ImageResponse } from "next/og"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

// Opaque background required: iOS applies its own corner mask
export default async function AppleIcon() {
    const mark = await readFile(join(process.cwd(), "public", "logo-unlabel.svg"))

    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#141210",
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={`data:image/svg+xml;base64,${mark.toString("base64")}`}
                    width={112}
                    height={102}
                    alt=""
                />
            </div>
        ),
        size,
    )
}
