"use client"

import { useEffect, useState } from "react";

/** Default wait applied by inputs that debounce their queries. */
export const DEFAULT_DEBOUNCE = 300;

/** Returns `value`, updated only after it stays unchanged for `delay` ms. */
export function useDebouncedValue<T>(value: T, delay = DEFAULT_DEBOUNCE): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timeout = setTimeout(() => setDebounced(value), delay);

        return () => clearTimeout(timeout);
    }, [value, delay]);

    return debounced;
}
