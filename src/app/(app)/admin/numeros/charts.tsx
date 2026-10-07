import type { BalancePoint } from "../../../../db/dashboard";
import { formatDay } from "../../../../ui/dates";
import { formatHours } from "../../../../ui/hours";
import { balanceToneClass, META_CLASS } from "../../../../ui/style";

/**
 * Hand-drawn SVG, no chart package (#9): bars and one line, in black, since the
 * palette has no colour per series (D42). Nothing moves.
 */

/** Past eight weeks a day is too thin a bar on a phone, so bars become weeks. */
const MAX_DAILY_BARS = 56;
const DAYS_PER_WEEK = 7;

export function bucketed(values: readonly number[]): number[] {
  if (values.length <= MAX_DAILY_BARS) return [...values];

  const weeks: number[] = [];
  for (let start = 0; start < values.length; start += DAYS_PER_WEEK) {
    weeks.push(
      values
        .slice(start, start + DAYS_PER_WEEK)
        .reduce((sum, value) => sum + value, 0),
    );
  }

  return weeks;
}

export function DayBars({
  label,
  max,
  values,
}: {
  label: string;
  max: number;
  values: readonly number[];
}) {
  const height = 40;
  const scale = max > 0 ? height / max : 0;

  return (
    <svg
      aria-label={label}
      className="block h-10 w-full text-black"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${values.length * 4} ${height}`}
    >
      <line
        stroke="currentColor"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
        x1="0"
        x2={values.length * 4}
        y1={height - 0.5}
        y2={height - 0.5}
      />
      {values.map((value, index) =>
        value > 0 ? (
          <rect
            fill="currentColor"
            height={Math.max(value * scale, 1)}
            // biome-ignore lint/suspicious/noArrayIndexKey: a bar is its position in time
            key={index}
            width="3"
            x={index * 4}
            y={height - Math.max(value * scale, 1)}
          />
        ) : null,
      )}
    </svg>
  );
}

export function BalanceLine({
  label,
  points,
}: {
  label: string;
  points: readonly BalancePoint[];
}) {
  const values = points.map((point) => point.balance);
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const span = top - bottom || 1;
  const height = 100;
  const width = Math.max(points.length - 1, 1);
  const y = (value: number) => ((top - value) / span) * height;
  const line = values
    .map((value, index) => `${points.length === 1 ? 0 : index},${y(value)}`)
    .join(" ");
  const first = points[0];
  const last = points.at(-1);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <div
          className={`flex w-14 shrink-0 text-xs font-bold flex-col justify-between text-right font-mono tabular-nums`}
        >
          <span className={balanceToneClass(top)}>{formatHours(top)}</span>
          <span className={balanceToneClass(bottom)}>
            {formatHours(bottom)}
          </span>
        </div>
        <svg
          aria-label={label}
          className="block h-28 w-full border-l-2 border-black text-black"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            stroke="currentColor"
            strokeDasharray="4 4"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            x1="0"
            x2={width}
            y1={y(0)}
            y2={y(0)}
          />
          <polyline
            fill="none"
            points={
              points.length === 1
                ? `0,${y(values[0] ?? 0)} ${width},${y(values[0] ?? 0)}`
                : line
            }
            stroke="currentColor"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      {first === undefined || last === undefined ? null : (
        <div className={`${META_CLASS} flex justify-between pl-16 text-black`}>
          <span>{formatDay(first.day)}</span>
          <span>{formatDay(last.day)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The three ledger flows, one black bar-row each (#87); no colour per series
 * (D42), so the label tells them apart and one scale spans all three to keep
 * them comparable. The total is text; a bar shows its value on hover.
 */
export function FlowBars({
  flows,
}: {
  flows: readonly { label: string; total: number; values: readonly number[] }[];
}) {
  const height = 24;
  const max = Math.max(0, ...flows.flatMap((flow) => flow.values));
  const scale = max > 0 ? height / max : 0;

  return (
    <div className="flex flex-col gap-2">
      {flows.map((flow) => (
        <div className="flex items-center gap-2" key={flow.label}>
          <span className={`${META_CLASS} w-16 shrink-0 text-black`}>
            {flow.label}
          </span>
          <svg
            aria-label={`${flow.label}: ${formatHours(flow.total)} no período`}
            className="block h-6 flex-1 text-black"
            preserveAspectRatio="none"
            role="img"
            viewBox={`0 0 ${Math.max(flow.values.length * 4, 1)} ${height}`}
          >
            <line
              stroke="currentColor"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              x1="0"
              x2={flow.values.length * 4}
              y1={height - 0.5}
              y2={height - 0.5}
            />
            {flow.values.map((value, index) =>
              value > 0 ? (
                <rect
                  fill="currentColor"
                  height={Math.max(value * scale, 1)}
                  // biome-ignore lint/suspicious/noArrayIndexKey: a bar is its position in time
                  key={index}
                  width="3"
                  x={index * 4}
                  y={height - Math.max(value * scale, 1)}
                >
                  <title>{formatHours(value)}</title>
                </rect>
              ) : null,
            )}
          </svg>
          <span className="w-14 shrink-0 text-right font-mono text-base tabular-nums text-black">
            {formatHours(flow.total)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A share of the row, as a block: `style` because the width is data. */
export function ShareBar({ share }: { share: number }) {
  return (
    <span aria-hidden="true" className="block h-3 w-full">
      <span
        className="block h-3 bg-black"
        style={{ width: `${Math.max(share * 100, 2)}%` }}
      />
    </span>
  );
}
