"use client"

/**
 * The recharts pieces a chart is drawn from, re-exported through the UI
 * package. recharts is a dependency of this package only — the apps reach it
 * through `transpilePackages`, and an app without it in its own
 * `package.json` cannot import "recharts" directly under pnpm's strict
 * layout. Kept beside `chart.tsx`, which owns the container, tooltip and
 * legend; add a primitive here the first time a chart needs it.
 */
export {
    Bar,
    BarChart,
    CartesianGrid,
    ComposedChart,
    LabelList,
    Line,
    LineChart,
    ReferenceLine,
    XAxis,
    YAxis,
} from "recharts"
