import { useEffect, useState } from "react";
import { IconDownload } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";

import { Button } from "@workspace/ui/components/button";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Spinner } from "@workspace/ui/components/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";

import { fillOrderTemplate, pdfFileName } from "@/lib/orders/pdf";
import type { CreateOrderForm } from "@/backend/schemas/order";

export type CreatedOrder = {
    orderId: string;
    status: CreateOrderForm["status"];
    // Which sheet action produced this — the copy differs, and "created"
    // must not show after an edit
    mode: "created" | "booked" | "saved";
    warning?: "SHEET_FAILED";
    values: CreateOrderForm;
};

const SUCCESS_KEYS = {
    created: { title: "success.title", description: "success.description" },
    booked: { title: "success.bookedTitle", description: "success.bookedDescription" },
    saved: { title: "success.savedTitle", description: "success.savedDescription" },
} as const satisfies Record<CreatedOrder["mode"], { title: string; description: string }>;

type DocumentUrls = {
    shipper: string;
    carrier: string;
};

export function CreateOrderSuccess({
    order,
    onClose,
}: {
    order: CreatedOrder | null;
    onClose: () => void;
}) {
    const t = useTranslations("Admin.order.create");
    const [documents, setDocuments] = useState<DocumentUrls | null>(null);

    const isBooked = order?.status === "booked";

    useEffect(() => {
        if (!order || order.status !== "booked") {
            return;
        }

        let cancelled = false;
        let urls: DocumentUrls | null = null;

        (async () => {
            const [shipper, carrier] = await Promise.all([
                fillOrderTemplate("shipper", order.orderId, order.values),
                fillOrderTemplate("carrier", order.orderId, order.values),
            ]);

            urls = {
                shipper: URL.createObjectURL(shipper),
                carrier: URL.createObjectURL(carrier),
            };

            if (cancelled) {
                URL.revokeObjectURL(urls.shipper);
                URL.revokeObjectURL(urls.carrier);
            } else {
                setDocuments(urls);
            }
        })();

        return () => {
            cancelled = true;

            if (urls) {
                URL.revokeObjectURL(urls.shipper);
                URL.revokeObjectURL(urls.carrier);
            }

            setDocuments(null);
        };
    }, [order]);

    return (
        <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t(order ? SUCCESS_KEYS[order.mode].title : "success.title")}</DialogTitle>
                    <DialogDescription>
                        {order && t(SUCCESS_KEYS[order.mode].description, { orderId: order.orderId })}
                    </DialogDescription>
                </DialogHeader>

                {order?.warning === "SHEET_FAILED" && (
                    <Alert variant="destructive">
                        <AlertDescription>{t("errors.sheetFailed")}</AlertDescription>
                    </Alert>
                )}

                {isBooked && (
                    <div className="flex flex-col gap-2">
                        {documents ? (
                            <>
                                <Button asChild variant="outline">
                                    <a href={documents.shipper} download={pdfFileName("shipper", order.orderId, order.values.shipperName)}>
                                        <IconDownload />
                                        {t("success.downloadShipper")}
                                    </a>
                                </Button>
                                <Button asChild variant="outline">
                                    <a href={documents.carrier} download={pdfFileName("carrier", order.orderId, order.values.carrierName)}>
                                        <IconDownload />
                                        {t("success.downloadCarrier")}
                                    </a>
                                </Button>
                            </>
                        ) : (
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Spinner />
                                {t("success.preparing")}
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t("success.close")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}