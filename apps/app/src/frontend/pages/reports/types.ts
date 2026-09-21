import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@/frontend/pages/movements/types";

type Get = (key: string) => string | null;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The report's input from the URL, shared by the server prefetch and the
 * client query so the first page hydrates — the same contract the loads
 * list keeps (movementsListInput).
 */
export const reportInput = (get: Get) => {
    const month = Number(get("month"));
    const page = Number(get("page"));
    const size = Number(get("size"));
    const date = (value: string | null) => (value && ISO_DATE.test(value) ? value : undefined);

    return {
        partner: get("partner")?.trim() || undefined,
        month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : undefined,
        from: date(get("from")),
        to: date(get("to")),
        page: Number.isInteger(page) && page > 0 ? page : 1,
        pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
    };
};
