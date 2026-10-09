export type Projection = {
  perHour: number;
  perDay: number;
  litresPerDay: number;
  intervalHours: number;
};

/**
 * Project a per-interval unexplained residual to a daily rate.
 * This is only a projection from the observed interval rate; the UI labels it
 * explicitly as "projected if sustained" and never presents it as guaranteed loss.
 */
export function projectedIfSustained(
  residualM3?: number | null,
  intervalStart?: string | null,
  intervalEnd?: string | null
): Projection | null {
  if (residualM3 === null || residualM3 === undefined || residualM3 <= 0.05) return null;
  if (!intervalStart || !intervalEnd) return null;
  const start = Date.parse(intervalStart);
  const end = Date.parse(intervalEnd);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const intervalHours = (end - start) / 3_600_000;
  const perHour = residualM3 / intervalHours;
  const perDay = perHour * 24;
  return { perHour, perDay, litresPerDay: perDay * 1000, intervalHours };
}
