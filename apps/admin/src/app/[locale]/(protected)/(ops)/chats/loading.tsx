// The view's frame — the same card the conversation list and thread live
// in — so the page takes its place at once; the list's own row skeletons
// take over as soon as the client view mounts
export default function Loading() {
    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden py-4">
            <div className="flex flex-1 min-h-0 overflow-hidden rounded-3xl border bg-card" />
        </div>
    )
}
