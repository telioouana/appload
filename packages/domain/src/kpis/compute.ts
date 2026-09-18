import { SAVINGS_DIVISOR } from "@workspace/domain/kpis/constants";
import type { KpiAggregate, KpiFigures, PartyType } from "@workspace/domain/kpis/types";

/**
 * The KPI report's arithmetic, in one pure function.
 *
 * No I/O and no clock: the procedure counts and sums in SQL, this divides.
 * Every definition is the KPI sheet's — on-time rates are counted over all
 * analysed transports, average durations over the trips that actually recorded
 * one (the sample count travels with the average, so the page can say "1 of
 * 72"), and distance per day is the distance per transport over its average
 * travelling days rather than a straight km ÷ days.
 *
 * A figure is `null` whenever its divisor is empty, never 0: an empty period
 * has no price per transport, and printing zero would read as a free trip.
 * Money is USD throughout — the conversion happened per trip, at its own
 * loading-day rate, before the aggregate was built.
 */

/** Every ratio on this page is null rather than 0 when its divisor is empty. */
const ratio = (numerator: number, divisor: number): number | null => (divisor > 0 ? numerator / divisor : null);

export function deriveKpis(type: PartyType, aggregate: KpiAggregate): KpiFigures {
    const transports = aggregate.transports;
    const kmPerTransport = ratio(aggregate.km, transports);
    const avgTravelDays = ratio(aggregate.travelDays, aggregate.travelDaysTrips);

    return {
        transports,
        total: aggregate.total,
        deliveries: aggregate.deliveries,
        tons: aggregate.tons,
        km: aggregate.km,
        pricePerTransport: ratio(aggregate.total, transports),
        tonsPerTransport: ratio(aggregate.tons, transports),
        kmPerTransport,
        onTimeLoadingRate: ratio(aggregate.onTimeLoading, transports),
        onTimeOffloadingRate: ratio(aggregate.onTimeOffloading, transports),
        avgLoadingDays: ratio(aggregate.loadingDays, aggregate.loadingDaysTrips),
        loadingDaysTrips: aggregate.loadingDaysTrips,
        avgTravelDays,
        travelDaysTrips: aggregate.travelDaysTrips,
        avgOffloadingDays: ratio(aggregate.offloadingDays, aggregate.offloadingDaysTrips),
        offloadingDaysTrips: aggregate.offloadingDaysTrips,
        avgBorderDays: ratio(aggregate.borderDays, aggregate.borderDaysTrips),
        borderDaysTrips: aggregate.borderDaysTrips,
        regionalTrips: aggregate.regionalTrips,
        // Sheet E42: the average trip's distance over the average trip's days,
        // not the period's total distance over its total days
        kmPerDay: kmPerTransport === null || avgTravelDays === null ? null : ratio(kmPerTransport, avgTravelDays),
        demurrageRate: ratio(aggregate.demurrageTrips, transports),
        demurrageDays: aggregate.demurrageDays,
        accidents: aggregate.accidents,
        mechanical: aggregate.mechanical,
        documentation: aggregate.documentation,
        police: aggregate.police,
        mechanicalDelayDays: aggregate.mechanicalDelayDays,
        documentationDelayDays: aggregate.documentationDelayDays,
        policeDelayDays: aggregate.policeDelayDays,
        delayDays: aggregate.mechanicalDelayDays + aggregate.documentationDelayDays + aggregate.policeDelayDays,
        damageRate: ratio(aggregate.damaged, transports),
        claimRate: ratio(aggregate.claimed, transports),
        costPerKm: ratio(aggregate.total, aggregate.km),
        costPerTon: ratio(aggregate.total, aggregate.tons),
        costPerTonKm: ratio(aggregate.total, aggregate.tonKm),
        backloadTrips: aggregate.backloadTrips,
        backloadShare: ratio(aggregate.backloadTrips, transports),
        co2: aggregate.co2,
        backload:
            type === "shipper"
                ? // Sheet M47: what the same freight would have cost without
                  // backloading, over every analysed trip and not only the
                  // backload ones
                  { kind: "savings", value: aggregate.total / SAVINGS_DIVISOR - aggregate.total }
                : { kind: "fuelMargin", value: ratio(aggregate.backloadTotal - aggregate.backloadFuel, aggregate.backloadFuel) },
        byCurrency: { MZN: aggregate.mzn, ZAR: aggregate.zar, USD: aggregate.usd },
        provisionalTransports: aggregate.provisional,
        unratedTransports: aggregate.unrated,
    };
}
