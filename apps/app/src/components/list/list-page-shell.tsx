/**
 * The frame every partner page's layout renders.
 *
 * Viewport-pinned: the header and the attention tiles stay put, and the
 * data slot takes whatever height is left without scrolling itself. The
 * list card inside it owns the scrolling — its toolbar, column headers and
 * pagination stay fixed while only the rows move.
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
        // breathing room is this frame's job
        <div className="flex h-full min-h-0 w-full flex-col gap-5 overflow-hidden pt-5 pb-2">
            {header}
            {stats}
            <div className="flex min-h-0 flex-1 flex-col">
                {data}
            </div>
        </div>
    )
}
