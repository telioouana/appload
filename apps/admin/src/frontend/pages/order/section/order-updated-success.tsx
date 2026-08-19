import { useEffect, useState } from "react";
import { IconDownload } from "@tabler/icons-react";

import { useTranslations } from "@workspace/i18n";
import type { Order } from "@workspace/db/orders";
import type { LoadingBay } from "@workspace/db/types";

import { Button } from "@workspace/ui/components/button";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Spinner } from "@workspace/ui/components/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";

import { fillOrderTemplate, orderToTemplateValues, pdfFileName } from "@/lib/orders/pdf";

export type UpdatedOrder = {
    orderId: string;
    order: Order;
    loadingBay: LoadingBay["type"] | null;
    warning?: "SHEET_FAILED";
};

type DocumentUrls = {
    shipper: string;
    carrier: string;
};

/**
 * Shown after a save touches a booked order's PDF-relevant fields: the
 * confirmation documents are regenerated from the updated row so the
 * downloads always match what was stored.
 */
export function OrderUpdatedSuccess({
    result,
    onClose,
}: {
    result: UpdatedOrder | null;
    onClose: () => void;
}) {
    const t = useTranslations("Admin.order.details");
    const [documents, setDocuments] = useState<DocumentUrls | null>(null);

    useEffect(() => {
        if (!result) {
            return;
        }

        let cancelled = false;
        let urls: DocumentUrls | null = null;

        (async () => {
            const values = orderToTemplateValues(result.order, result.loadingBay);

            const [shipper, carrier] = await Promise.all([
                fillOrderTemplate("shipper", result.orderId, values),
                fillOrderTemplate("carrier", result.orderId, values),
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
    }, [result]);

    return (
        <Dialog open={!!result} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("success.title")}</DialogTitle>
                    <DialogDescription>
                        {result && t("success.description", { orderId: result.orderId })}
                    </DialogDescription>
                </DialogHeader>

                {result?.warning === "SHEET_FAILED" && (
                    <Alert variant="destructive">
                        <AlertDescription>{t("errors.sheetFailed")}</AlertDescription>
                    </Alert>
                )}

                <div className="flex flex-col gap-2">
                    {documents && result ? (
                        <>
                            <Button asChild variant="outline">
                                <a href={documents.shipper} download={pdfFileName("shipper", result.orderId, result.order.shipperName)}>
                                    <IconDownload />
                                    {t("success.downloadShipper")}
                                </a>
                            </Button>
                            <Button asChild variant="outline">
                                <a href={documents.carrier} download={pdfFileName("carrier", result.orderId, result.order.carrierName)}>
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

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t("success.close")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
