import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ImageResponse } from "next/og"

export const size = { width: 512, height: 512 }
export const contentType = "image/png"

// The bare Appload mark (red/orange gradient) on the site's dark canvas
export default async function Icon() {
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
                    borderRadius: 96,
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={`data:image/svg+xml;base64,${mark.toString("base64")}`}
                    width={320}
                    height={290}
                    alt=""
                />
            </div>
        ),
        size,
    )
}
