import { ListPageShell } from "@workspace/ui/customs/list/list-page-shell"
import { HeaderSkeleton, ListSkeleton } from "@workspace/ui/customs/list/list-fallbacks"

export default function Loading() {
    return <ListPageShell header={<HeaderSkeleton />} stats={null} data={<ListSkeleton />} />
}
