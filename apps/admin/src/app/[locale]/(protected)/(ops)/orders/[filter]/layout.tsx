export default function PrivateOrdersLayout({
    header,
    data,
}: {
    header: React.ReactNode,
    data: React.ReactNode,
}) {
    return (
        // Pinned to the viewport: the header stays put, only the data
        // slot scrolls (the sentinel-based infinite scroll keeps working —
        // the observer tracks viewport visibility after clipping)
        <div className="flex flex-col gap-6 w-full h-full min-h-0 overflow-hidden pb-4">
            {header}
            <div className="flex-1 min-h-0 overflow-y-auto rounded-4xl container-snap">
                {data}
            </div>
        </div>
    )
}
