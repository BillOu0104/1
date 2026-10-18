/** Step arithmetic is relative to min, matching HTML inputs, with floating-point tolerance. */
export function validNumeric(
  value: unknown,
  min: number,
  max: number,
  step: number,
): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    return false;
  const ticks = (value - min) / step;
  return (
    Math.abs(ticks - Math.round(ticks)) <= Math.max(1e-7, Math.abs(ticks) * Number.EPSILON * 4)
  );
}
export function decimalPlaces(step: number): number {
  return Math.max(0, Math.ceil(-Math.log10(step)));
}
