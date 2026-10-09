import { Spinner } from "@workspace/ui/components/spinner"

export default function Loading() {
    return (
        <div className="container-snap mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto py-4">
            <Spinner className="mx-auto my-8" />
        </div>
    )
}
