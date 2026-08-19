/**
 * Returns the violated constraint name when the error (or its cause) is a
 * postgres unique violation (23505), else null. Used to map duplicates to
 * domain error codes.
 */
export function uniqueViolationConstraint(error: unknown): string | null {
    return violationConstraint(error, "23505");
}

/** Same, for foreign-key violations (23503). */
export function foreignKeyViolationConstraint(error: unknown): string | null {
    return violationConstraint(error, "23503");
}

function violationConstraint(error: unknown, code: string): string | null {
    const candidates = [error, (error as { cause?: unknown })?.cause] as Array<
        { code?: string; constraint?: string; detail?: string } | undefined
    >;

    for (const candidate of candidates) {
        if (candidate?.code === code) {
            return candidate.constraint ?? candidate.detail ?? "";
        }
    }

    return null;
}
