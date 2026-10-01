"use client"

import { useQuery } from "@tanstack/react-query"
import { IconTruck, IconPackages } from "@tabler/icons-react"

import { useTranslations } from "@workspace/i18n"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"

import { useTRPC } from "@/backend/api/client"
import { ContractSheet } from "@/frontend/pages/contracts/sections/contract-sheet"
import { useNewLoad, type NewLoadKind } from "@/frontend/pages/movements/hooks/use-new-load"
import { LoadSheet } from "@/frontend/pages/movements/sections/load-sheet"

/**
 * The one new-load sheet, mounted by the rail so it is there on every page:
 * the rail's own button and the lists' empty states open it through the
 * store, on the shape they are about. Nothing of it exists until it is first
 * opened (see `armed`).
 *
 * The first thing it asks, when the caller did not say, is whether this is
 * one trip or an order that takes several — a client with 5 000 t to move
 * has one order, not a contract and then trips. One trip opens the load
 * form; several opens the multi-trip order form (the contract sheet, which
 * is the same row under another name).
 */
export function NewLoadSheet() {
    const armed = useNewLoad((state) => state.armed)

    return armed ? <ArmedSheet /> : null
}

function ArmedSheet() {
    const trpc = useTRPC()
    const { isOpen, execution, contractAllocationId, kind, choose, close } = useNewLoad()

    const { data: session } = useQuery(trpc.me.session.queryOptions())

    if (!session) return null

    if (kind === null) {
        return <KindChooser open={isOpen} onChoose={choose} onClose={close} />
    }

    if (kind === "multi") {
        return <ContractSheet open={isOpen} onOpenChange={(next) => { if (!next) close() }} mode={{ kind: "create" }} />
    }

    return (
        <LoadSheet
            mode={{ kind: "create", execution, contractAllocationId }}
            orgType={session.organization.type}
            allowance={session.allowance}
            organizationName={session.organization.name}
            open={isOpen}
            onOpenChange={(next) => { if (!next) close() }}
        />
    )
}

const KINDS: { value: NewLoadKind; Icon: typeof IconTruck }[] = [
    { value: "single", Icon: IconTruck },
    { value: "multi", Icon: IconPackages },
]

/** One trip, or several: the one question before either form. */
function KindChooser({ open, onChoose, onClose }: { open: boolean; onChoose: (kind: NewLoadKind) => void; onClose: () => void }) {
    const t = useTranslations("App.loads.form.kind")

    return (
        <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
            <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-[520px]">
                <SheetHeader className="border-b">
                    <SheetTitle>{t("title")}</SheetTitle>
                    <SheetDescription>{t("description")}</SheetDescription>
                </SheetHeader>

                <div className="grid gap-3 px-6 py-5" role="radiogroup" aria-label={t("title")}>
                    {KINDS.map(({ value, Icon }) => (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={false}
                            onClick={() => onChoose(value)}
                            className="hover:bg-muted flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors"
                        >
                            <Icon className="mt-0.5 size-5 shrink-0" stroke={1.5} />
                            <span className="min-w-0">
                                <span className="block text-sm font-medium">{t(value)}</span>
                                <span className="text-muted-foreground block text-xs leading-5">{t(`${value}-hint`)}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </SheetContent>
        </Sheet>
    )
}
