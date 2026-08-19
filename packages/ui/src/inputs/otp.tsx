"use client"

import { Base } from "@workspace/ui/inputs/base";
import { ControlFunc } from "@workspace/ui/inputs/types";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@workspace/ui/components/input-otp";

export const OTPInput: ControlFunc = props => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const REGEX_OTP_NUMBERS_VALIDATION: any = /^[0-9]+$/

    return <Base {...props}>{(field) => (
        <InputOTP
            {...field}
            maxLength={6}
            className="w-full"
            disabled={props.isPending}
            pattern={REGEX_OTP_NUMBERS_VALIDATION}
        >
            <InputOTPGroup><InputOTPSlot index={0} /></InputOTPGroup>
            <InputOTPGroup><InputOTPSlot index={1} /></InputOTPGroup>
            <InputOTPGroup><InputOTPSlot index={2} /></InputOTPGroup>
            <InputOTPGroup><InputOTPSlot index={3} /></InputOTPGroup>
            <InputOTPGroup><InputOTPSlot index={4} /></InputOTPGroup>
            <InputOTPGroup><InputOTPSlot index={5} /></InputOTPGroup>
        </InputOTP>
    )}</Base>
}