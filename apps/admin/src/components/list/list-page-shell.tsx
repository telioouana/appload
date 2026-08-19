/**
 * The frame every partner page's layout renders.
 *
 * Same viewport-pinned shape as the orders pages: the header and stat strip
 * stay put and only the data slot scrolls, so the filters remain reachable
 * while a long list is being read. The sentinel-based infinite scroll keeps
 * working because the observer tracks viewport visibility after clipping.
 */
export function ListPageShell({
    header,
    stats,
    data,
}: {
    header: React.ReactNode
    stats: React.ReactNode
    data: React.ReactNode
}) {
    return (
        // The protected layout only pads horizontally, so the vertical
        // breathing room is this frame's job — same 4 top and bottom
        <div className="flex h-full min-h-0 w-full flex-col gap-6 overflow-hidden py-4 px-px">
            {header}
            {stats}
            <div className="container-snap min-h-0 flex-1 overflow-y-auto rounded-4xl">
                {data}
            </div>
        </div>
    )
}
