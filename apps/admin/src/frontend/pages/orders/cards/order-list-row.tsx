"use client"

import { Separator } from "@workspace/ui/components/separator";
import { Card, CardContent } from "@workspace/ui/components/card";

import type { OrderValues } from "@/frontend/pages/orders/types";
import { CargoFlags } from "@/frontend/pages/orders/sections/order-item-shared";
import {
    LoadingDateField,
    OperationsStrip,
    OrderActions,
    OrderIdentity,
    PartyBlock,
    RouteField,
    ShipmentTotal
} from "@/frontend/pages/orders/sections/order-item-parts";

export function OrderListRow({ order }: { order: OrderValues }) {
    return (
        <Card className="transition-colors hover:border-primary/40">
            <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:gap-6">
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                    {/* what the shipment is — two columns on phones, the
                        full track layout from md upward */}
                    <div className="grid grid-cols-2 items-start gap-4 md:grid-cols-12">
                        <div className="flex min-w-0 flex-col gap-2 md:col-span-3">
                            <OrderIdentity order={order} />
                            <CargoFlags order={order} />
                        </div>

                        <RouteField order={order} className="md:col-span-4" />
                        <LoadingDateField order={order} className="md:col-span-3" />
                        <ShipmentTotal order={order} className="md:col-span-2" />
                    </div>

                    <Separator />

                    {/* who owes whom */}
                    <div className="flex flex-col gap-3">
                        <PartyBlock order={order} party="shipper" layout="row" />
                        <PartyBlock order={order} party="carrier" layout="row" />
                    </div>

                    <Separator />

                    {/* who is driving it */}
                    <OperationsStrip order={order} />
                </div>

                <OrderActions order={order} orientation="vertical" className="w-full shrink-0 md:w-32" />
            </CardContent>
        </Card>
    );
}
