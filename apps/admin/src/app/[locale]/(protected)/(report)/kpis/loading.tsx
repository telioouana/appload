import { ListPageShell } from "@/components/list/list-page-shell"
import { KpisHeaderSkeleton } from "@/frontend/pages/kpis/views/kpis-fallbacks"
import { ListSkeleton, TilesSkeleton } from "@/frontend/pages/partners/views/list-fallbacks"

// The page's own frame around the three band placeholders, so the shape is on
// screen the moment the route is entered — before the page has streamed in
export default function Loading() {
    return <ListPageShell header={<KpisHeaderSkeleton />} stats={<TilesSkeleton />} data={<ListSkeleton />} />
}
