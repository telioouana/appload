import { useFormContext } from "react-hook-form";

import { useTranslations } from "@workspace/i18n";
import { CURRENCY, INSURANCE_PAYMENT_STATUS, INSURANCE_SUBSCRIBER, PAYMENT_STATUS } from "@workspace/db/types";

import { DateInput } from "@workspace/ui/inputs/date";
import { TextInput } from "@workspace/ui/inputs/text";
import { SelectInput } from "@workspace/ui/inputs/select";
import { DecimalInput } from "@workspace/ui/inputs/decimal";
import { SelectItem } from "@workspace/ui/components/select";
import { FieldGroup, FieldLegend, FieldSeparator, FieldSet, FieldTitle } from "@workspace/ui/components/field";

import { UpdateOrderForm, UpdateOrderFormInput } from "@/backend/schemas/order";
import { PAYMENT_KEYS } from "@/lib/orders/payments";

type Party = "carrier" | "shipper";

type FormProps = {
    isPending: boolean
    // Parties whose paid fields are derived from proofs of payment: the
    // server rejects a changed value (POP_PAYMENT_LOCKED), so the inputs
    // are truly disabled rather than merely hinted
    lockedParties: Record<Party, boolean>
}

// Stored orders reach back to previous years; keep their dates selectable
const EARLIEST_DATE = new Date(2020, 0, 1);

function PaymentFields({ party, isPending, locked }: { party: Party; isPending: boolean; locked: boolean }) {
    const t = useTranslations("Admin.order.update.form.payment.fields")
    const { control } = useFormContext<UpdateOrderFormInput, unknown, UpdateOrderForm>()

    return (
        <FieldSet>
            <FieldLegend>
                <FieldTitle>{t(`${party}.title`)}</FieldTitle>
            </FieldLegend>
            <FieldGroup>
                <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                    <TextInput
                        control={control}
                        name={`${party}InvoiceNumber`}
                        label={t(`${party}.invoiceNumber.label`)}
                        placeholder={t(`${party}.invoiceNumber.placeholder`)}
                        isPending={isPending}
                    />

                    <DateInput
                        control={control}
                        name={`${party}InvoiceDate`}
                        value={EARLIEST_DATE}
                        label={t(`${party}.invoiceDate.label`)}
                        placeholder={t(`${party}.invoiceDate.placeholder`)}
                        isPending={isPending}
                    />

                    <DecimalInput
                        control={control}
                        name={`${party}Subtotal`}
                        label={t(`${party}.subtotal.label`)}
                        placeholder={t(`${party}.subtotal.placeholder`)}
                        isPending={isPending}
                    />

                    <DecimalInput
                        control={control}
                        name={`${party}VAT`}
                        label={t(`${party}.vat.label`)}
                        placeholder={t(`${party}.vat.placeholder`)}
                        isPending={isPending}
                    />

                    <DecimalInput
                        control={control}
                        name={`${party}Total`}
                        label={t(`${party}.total.label`)}
                        placeholder={t(`${party}.total.placeholder`)}
                        isPending={isPending}
                    />

                    <SelectInput
                        control={control}
                        name={`${party}Currency`}
                        label={t(`${party}.currency.label`)}
                        placeholder={t(`${party}.currency.placeholder`)}
                        isPending={isPending}
                    >
                        {CURRENCY.map((item, index) => <SelectItem key={index} value={item}>{t(`${party}.currency.options.${item}`)}</SelectItem>)}
                    </SelectInput>

                    {/* Paid fields: read-only once the leg is governed by proofs
                        of payment — record or void a proof to change them.
                        Invoice fields above stay editable (the currency lock
                        is enforced server-side only). Whether a payment is
                        partial is what the payment status says. */}
                    <DecimalInput
                        control={control}
                        name={PAYMENT_KEYS[party].amount}
                        label={t(`${party}.paidAmount.label`)}
                        placeholder={t(`${party}.paidAmount.placeholder`)}
                        description={locked ? t("lockedHint") : undefined}
                        isPending={isPending}
                        disabled={locked}
                    />

                    <SelectInput
                        control={control}
                        name={`${party}PaymentStatus`}
                        label={t(`${party}.paymentStatus.label`)}
                        placeholder={t(`${party}.paymentStatus.placeholder`)}
                        isPending={isPending}
                        disabled={locked}
                    >
                        {PAYMENT_STATUS.map((item, index) => <SelectItem key={index} value={item}>{t(`${party}.paymentStatus.options.${item}`)}</SelectItem>)}
                    </SelectInput>

                    <DateInput
                        control={control}
                        name={`${party}FullPaymentDate`}
                        value={EARLIEST_DATE}
                        label={t(`${party}.fullPaymentDate.label`)}
                        placeholder={t(`${party}.fullPaymentDate.placeholder`)}
                        isPending={isPending}
                        disabled={locked}
                    />
                </FieldGroup>
            </FieldGroup>
        </FieldSet>
    )
}

export function AccountingDetailsForm({ isPending, lockedParties }: FormProps) {
    const t = useTranslations("Admin.order.update.form")
    const { control } = useFormContext<UpdateOrderFormInput, unknown, UpdateOrderForm>()

    return (
        <FieldGroup>
            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("payment.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup>
                    <PaymentFields party="carrier" isPending={isPending} locked={lockedParties.carrier} />
                    <PaymentFields party="shipper" isPending={isPending} locked={lockedParties.shipper} />

                    <FieldSet>
                        <FieldLegend>
                            <FieldTitle>{t("payment.fields.commission.title")}</FieldTitle>
                        </FieldLegend>
                        <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-3 items-start">
                            <DecimalInput
                                control={control}
                                name="apploadCommissionSubtotal"
                                label={t("payment.fields.commission.subtotal.label")}
                                placeholder={t("payment.fields.commission.subtotal.placeholder")}
                                isPending={isPending}
                            />

                            <DecimalInput
                                control={control}
                                name="apploadCommissionVAT"
                                label={t("payment.fields.commission.vat.label")}
                                placeholder={t("payment.fields.commission.vat.placeholder")}
                                isPending={isPending}
                            />

                            <DecimalInput
                                control={control}
                                name="apploadCommissionTotal"
                                label={t("payment.fields.commission.total.label")}
                                placeholder={t("payment.fields.commission.total.placeholder")}
                                isPending={isPending}
                            />
                        </FieldGroup>
                    </FieldSet>
                </FieldGroup>
            </FieldSet>

            <FieldSet>
                <FieldLegend>
                    <FieldTitle>{t("insurance.title")}</FieldTitle>
                </FieldLegend>
                <FieldSeparator />
                <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
                    <SelectInput
                        control={control}
                        name="insuranceSubscriber"
                        label={t("insurance.fields.subscriber.label")}
                        placeholder={t("insurance.fields.subscriber.placeholder")}
                        isPending={isPending}
                    >
                        {INSURANCE_SUBSCRIBER.map((item, index) => <SelectItem key={index} value={item}>{t(`insurance.fields.subscriber.options.${item}`)}</SelectItem>)}
                    </SelectInput>

                    <DecimalInput
                        control={control}
                        name="insuranceValue"
                        label={t("insurance.fields.value.label")}
                        placeholder={t("insurance.fields.value.placeholder")}
                        isPending={isPending}
                    />

                    <SelectInput
                        control={control}
                        name="insuranceCurrency"
                        label={t("insurance.fields.currency.label")}
                        placeholder={t("insurance.fields.currency.placeholder")}
                        isPending={isPending}
                    >
                        {CURRENCY.map((item, index) => <SelectItem key={index} value={item}>{t(`insurance.fields.currency.options.${item}`)}</SelectItem>)}
                    </SelectInput>

                    <SelectInput
                        control={control}
                        name="insuranceStatus"
                        label={t("insurance.fields.status.label")}
                        placeholder={t("insurance.fields.status.placeholder")}
                        isPending={isPending}
                    >
                        {INSURANCE_PAYMENT_STATUS.map((item, index) => <SelectItem key={index} value={item}>{t(`insurance.fields.status.options.${item}`)}</SelectItem>)}
                    </SelectInput>
                </FieldGroup>
            </FieldSet>
        </FieldGroup>
    )
}
