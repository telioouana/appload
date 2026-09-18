"use client"

import { useEffect, useState } from "react";

const COOLDOWN_SECONDS = 60;

/**
 * One verification email at a time, and a minute between attempts.
 *
 * Better Auth's rate limiter caps /send-verification-email at 3 per minute
 * and answers 429, which both resend screens can only report as "we could not
 * send the link, try again" — telling the user to do the one thing that is
 * failing. The button stops being clickable instead.
 *
 * `send` reports whether the mail actually went out; a failure leaves the
 * button live so a real retry is still possible.
 */
export function useResendCooldown(send: () => Promise<boolean>) {
    const [isSending, setSending] = useState(false)
    const [secondsLeft, setSecondsLeft] = useState(0)

    useEffect(() => {
        if (secondsLeft <= 0) return

        const timer = setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000)

        return () => clearTimeout(timer)
    }, [secondsLeft])

    async function resend() {
        if (isSending || secondsLeft > 0) return

        setSending(true)

        const sent = await send()

        setSending(false)

        if (sent) setSecondsLeft(COOLDOWN_SECONDS)
    }

    return { isSending, secondsLeft, resend }
}
