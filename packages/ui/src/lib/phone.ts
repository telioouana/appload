import { countryCodes } from "@workspace/ui/lib/country-codes";

/**
 * Appload is a Maputo operator: staff, drivers and carriers are Mozambican
 * numbers, so this is the resting selection for an empty field and the
 * tie-break when a dial code is shared.
 */
export const DEFAULT_PHONE_COUNTRY = "Mozambique";

/**
 * Folds a country selection and a locally typed number into E.164.
 *
 * `PhoneInput` renders the dial code beside the field and never writes it
 * into the field value, so what react-hook-form holds is the national number
 * ("82 123 4567"). Everything downstream dials E.164 — Better Auth's phone
 * plugin, the tracking jobs, the order form — so the composition lives here
 * rather than being re-derived in every form.
 *
 * Returns "" when either half is missing, so an untouched field fails the
 * form's own `z.e164()` check instead of submitting a bare "+258".
 */
export function toE164(country: string, national: string | null | undefined): string {
    const dial = countryCodes.find((entry) => entry.country === country)?.code ?? "";
    const dialDigits = dial.replace(/\D/g, "");
    // Trunk prefix: "082 123 4567" is the same subscriber as "+258 82 123 4567"
    const localDigits = String(national ?? "").replace(/\D/g, "").replace(/^0+/, "");

    if (!dialDigits || !localDigits) return "";

    return `+${dialDigits}${localDigits}`;
}

/**
 * Splits a stored E.164 number back into the pair `PhoneInput` needs.
 *
 * Longest dial code wins, and among equal-length codes the default country
 * wins, so the selector lands somewhere predictable rather than on whichever
 * row happened to sort first.
 *
 * That is only a best guess for shared dial codes, because `country-codes.ts`
 * stores every NANP territory as a bare "+1" (the area code lives in the
 * placeholder, not the code) and the Crown dependencies as "+44" alongside the
 * UK. So "+12642351234" resolves to a +1 country, not necessarily Anguilla.
 * Harmless in both directions that matter: `toE164` composes identically for
 * every country sharing a code, so the round trip is exact and only the flag
 * beside the field can be a sibling territory. Mozambique — the only code this
 * app routinely handles — is unambiguous.
 */
export function fromE164(value: string | null | undefined): { country: string; national: string } {
    const digits = String(value ?? "").replace(/\D/g, "");

    if (!digits) return { country: DEFAULT_PHONE_COUNTRY, national: "" };

    const match = countryCodes
        .map((entry) => ({ entry, dial: entry.code.replace(/\D/g, "") }))
        .filter(({ dial }) => dial.length > 0 && digits.startsWith(dial))
        .sort((a, b) =>
            b.dial.length - a.dial.length
            || Number(b.entry.country === DEFAULT_PHONE_COUNTRY) - Number(a.entry.country === DEFAULT_PHONE_COUNTRY),
        )[0];

    if (!match) return { country: DEFAULT_PHONE_COUNTRY, national: digits };

    return { country: match.entry.country, national: digits.slice(match.dial.length) };
}
