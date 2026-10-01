import type { RentalDayState } from "@workspace/db/rentals";
import type { PriceModel } from "@workspace/db/types";

import type { BillableDays } from "@workspace/domain/contracts/price";

/**
 * What a rental line is worth, read from its period, its mode and its log.
 * The rule (Claire, 2026-10-01): the whole period is billed unless a day is
 * marked — a stopped or off day is not billed, a standby day is billed at
 * the standby rate when one was agreed, else at the full rate. Pure, so
 * the arithmetic is checked on its own below; nothing is stored.
 */

export type PerDay = Extract<PriceModel, { model: "per-day" }>;

export type LogEntry = {
    day: string;
    state: RentalDayState;
    disputedAt: Date | null;
    driverAnswer: "yes" | "no" | null;
};

export type RentalDayView = {
    day: string;
    state: RentalDayState;
    /** Counts towards the amount: worked, or standby */
    billable: boolean;
    disputed: boolean;
    answer: "yes" | "no" | null;
};

export type LineBilling = {
    worked: number;
    standby: number;
    stopped: number;
    off: number;
    billableDays: number;
    amount: number;
};

export type MonthRow = { month: string; worked: number; standby: number; amount: number };

const DAY_MS = 86_400_000;
const round = (value: number) => Math.round(value * 100) / 100;

const dayOf = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const isoOf = (date: Date): string => date.toISOString().slice(0, 10);

/** Every day from `from` to `to` inclusive under the mode; working days skip Sundays (Mon–Sat, as the crons' week). */
export function periodDays(from: string, to: string, mode: BillableDays): string[] {
    const days: string[] = [];
    if (to < from) return days;

    for (let at = dayOf(from); at.getTime() <= dayOf(to).getTime(); at = new Date(at.getTime() + DAY_MS)) {
        if (mode === "working" && at.getUTCDay() === 0) continue;
        days.push(isoOf(at));
    }

    return days;
}

/** The earlier of two days, where null means "no end". */
const earliest = (...days: (string | null)[]) =>
    days.filter((day): day is string => day !== null).sort()[0] ?? null;

/**
 * The line's days up to today, each as the log says it counts. The line
 * starts with the order and ends with its own end, the order's, or today,
 * whichever comes first.
 */
export function lineDays(input: {
    startsOn: string;
    orderEndsOn: string | null;
    lineEndsOn: string | null;
    mode: BillableDays;
    log: LogEntry[];
    today: string;
}): RentalDayView[] {
    const to = earliest(input.today, input.orderEndsOn, input.lineEndsOn);
    if (to === null || to < input.startsOn) return [];

    const byDay = new Map(input.log.map((entry) => [entry.day, entry]));

    return periodDays(input.startsOn, to, input.mode).map((day) => {
        const entry = byDay.get(day);
        const state = entry?.state ?? "worked";

        return {
            day,
            state,
            billable: state === "worked" || state === "standby",
            disputed: entry?.disputedAt !== null && entry?.disputedAt !== undefined,
            answer: entry?.driverAnswer ?? null,
        };
    });
}

export function lineBilling(days: RentalDayView[], model: PerDay | null): LineBilling {
    const count = (state: RentalDayState) => days.filter((day) => day.state === state).length;
    const worked = count("worked");
    const standby = count("standby");
    const rate = model?.rate ?? 0;
    const standbyRate = model?.standbyRate ?? rate;

    return {
        worked,
        standby,
        stopped: count("stopped"),
        off: count("off"),
        billableDays: worked + standby,
        amount: round(worked * rate + standby * standbyRate),
    };
}

/** The same, one row per calendar month, for the statement a client pays against. */
export function monthlyStatement(days: RentalDayView[], model: PerDay | null): MonthRow[] {
    const months = new Map<string, RentalDayView[]>();
    for (const day of days) {
        const month = day.day.slice(0, 7);
        months.set(month, [...(months.get(month) ?? []), day]);
    }

    return [...months.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, rows]) => {
            const billing = lineBilling(rows, model);
            return { month, worked: billing.worked, standby: billing.standby, amount: billing.amount };
        });
}

/** How many days the whole period holds under the mode; null while the period is open. */
export function projectedDays(startsOn: string, endsOn: string | null, mode: BillableDays): number | null {
    return endsOn === null ? null : periodDays(startsOn, endsOn, mode).length;
}

// pnpm dlx tsx packages/domain/src/rentals/billing.ts — the arithmetic on its own
if (process.argv[1]?.endsWith("billing.ts")) {
    const eq = (name: string, got: unknown, want: unknown) => {
        if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    };
    const model: PerDay = { model: "per-day", rate: 25_000, billableDays: "working", standbyRate: 12_000 };

    // Mon 2026-09-28 … Sat 2026-10-10 working days: 12 (two Sundays skipped)
    eq("working days skip Sundays", periodDays("2026-09-28", "2026-10-10", "working").length, 12);
    eq("calendar days do not", periodDays("2026-09-28", "2026-10-10", "calendar").length, 13);

    const days = lineDays({
        startsOn: "2026-09-28", orderEndsOn: "2026-10-31", lineEndsOn: null, mode: "working", today: "2026-10-10",
        log: [
            { day: "2026-09-30", state: "stopped", disputedAt: null, driverAnswer: "no" },
            { day: "2026-10-02", state: "standby", disputedAt: null, driverAnswer: "yes" },
            { day: "2026-10-05", state: "worked", disputedAt: new Date(), driverAnswer: null },
            { day: "2026-10-04", state: "off", disputedAt: null, driverAnswer: null }, // a Sunday: not in the period under working days
        ],
    });
    eq("the period to today, under the mode", days.length, 12);
    const billing = lineBilling(days, model);
    eq("the whole period unless marked", billing, { worked: 10, standby: 1, stopped: 1, off: 0, billableDays: 11, amount: 10 * 25_000 + 12_000 });
    eq("a disputed day is still billed, and says so", days.find((day) => day.day === "2026-10-05"), { day: "2026-10-05", state: "worked", billable: true, disputed: true, answer: null });
    eq("standby without a standby rate is the full rate", lineBilling(days, { model: "per-day", rate: 25_000, billableDays: "working" }).amount, 11 * 25_000);

    eq("one statement row per month", monthlyStatement(days, model).map((row) => [row.month, row.amount]), [["2026-09", 2 * 25_000], ["2026-10", 8 * 25_000 + 12_000]]);

    eq("a line that ended early stops there", lineDays({ startsOn: "2026-09-28", orderEndsOn: null, lineEndsOn: "2026-09-30", mode: "calendar", log: [], today: "2026-10-10" }).length, 3);
    eq("nothing before the start", lineDays({ startsOn: "2026-10-20", orderEndsOn: null, lineEndsOn: null, mode: "calendar", log: [], today: "2026-10-10" }).length, 0);
    eq("an open period projects nothing", projectedDays("2026-09-28", null, "working"), null);
    eq("a closed one projects its days", projectedDays("2026-09-28", "2026-10-10", "working"), 12);
    console.log("ok");
}
