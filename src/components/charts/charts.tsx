"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Charts follow one rule set: a single measure per chart (no dual axes), thin marks, 4px rounded
 * bar ends, hairline grid, hover tooltips, and a table alternative so meaning never depends on colour alone.
 */
const AXIS = { fill: "var(--viz-text)", fontSize: 12 } as const;
const GRID = "var(--viz-grid)";

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { value?: number | string; name?: string }[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums text-muted-foreground">
          {p.value ?? "—"}
          {unit ? ` ${unit}` : ""}
        </p>
      ))}
    </div>
  );
}

export function ChartCard({
  title,
  description,
  empty,
  children,
  table,
}: {
  title: string;
  description?: string;
  empty?: boolean;
  children: React.ReactNode;
  table: { columns: string[]; rows: (string | number | null)[][] };
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-medium">{title}</h2>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <div
        className="mt-3 h-64"
        role="img"
        aria-label={`${title}. A table with the same data is available below.`}
      >
        {empty ? (
          <p className="grid h-full place-items-center text-sm text-muted-foreground">
            No data for this period.
          </p>
        ) : (
          children
        )}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">View as table</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} className="py-1 pr-4 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {r.map((v, j) => (
                    <td key={j} className="py-1 pr-4 tabular-nums">
                      {v ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

/** Single-series line over time (2px line, no marker clutter, crosshair via tooltip). */
export function LineOverTime({
  data,
  unit,
  domain,
}: {
  data: { date: string; value: number | null }[];
  unit?: string;
  domain?: [number, number];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 256 }}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: "var(--viz-axis)" }}
          minTickGap={32}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          domain={domain}
          width={44}
        />
        <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ stroke: "var(--viz-axis)" }} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--viz-1)"
          strokeWidth={2}
          dot={
            data.filter((d) => d.value !== null).length <= 2
              ? { r: 4, fill: "var(--viz-1)", stroke: "var(--viz-surface)", strokeWidth: 2 }
              : false
          }
          activeDot={{ r: 4, stroke: "var(--viz-surface)", strokeWidth: 2 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars for ranked categories (locations). */
export function HorizontalBars({ data, unit }: { data: { name: string; value: number }[]; unit?: string }) {
  const height = Math.max(data.length * 34 + 40, 160); // room for the axis as well as the bars
  return (
    <div className="h-full overflow-y-auto">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 500, height }}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
            barCategoryGap={8}
          >
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: "var(--viz-axis)" }}
              width={110}
            />
            <Tooltip
              content={<ChartTooltip unit={unit} />}
              cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
            />
            <Bar dataKey="value" fill="var(--viz-1)" radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Vertical bars for a small ordered set (ratings 1–5, answer options). */
export function VerticalBars({ data, unit }: { data: { name: string; value: number }[]; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 500, height: 256 }}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="name"
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: "var(--viz-axis)" }}
          interval={0}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
        <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }} />
        <Bar dataKey="value" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ResponsiveContainer>
  );
}
