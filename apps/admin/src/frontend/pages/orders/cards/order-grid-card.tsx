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

export function OrderGridCard({ order }: { order: OrderValues }) {
    return (
        <Card className="h-full transition-colors hover:border-primary/40">
            <CardContent className="flex h-full flex-col gap-4 p-4">
                {/* what the shipment is */}
                <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                        <OrderIdentity order={order} />
                        <ShipmentTotal order={order} className="shrink-0" />
                    </div>

                    <CargoFlags order={order} />

                    <div className="flex items-start justify-between gap-3">
                        <RouteField order={order} orientation="stacked" className="min-w-0 flex-1" />
                        <LoadingDateField order={order} className="shrink-0" />
                    </div>
                </div>

                <Separator />

                {/* who owes whom */}
                <div className="flex flex-col gap-4">
                    <PartyBlock order={order} party="shipper" layout="stacked" />
                    <PartyBlock order={order} party="carrier" layout="stacked" />
                </div>

                <Separator />

                {/* who is driving it */}
                <OperationsStrip order={order} />

                <OrderActions order={order} orientation="horizontal" className="mt-auto pt-1" />
            </CardContent>
        </Card>
    );
}