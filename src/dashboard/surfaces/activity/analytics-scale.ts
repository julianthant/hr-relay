export const clock = (seconds: number) => `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
/** Four evenly spaced ticks from 0 up to a round top, for counts. */
export function countScale(max: number) {
  const raw = Math.max(max, 1) / 3, magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find(factor => factor * magnitude >= raw) ?? 10) * magnitude;
  return { top: step * 3, ticks: [3, 2, 1, 0].map(k => ({ value: k * step, label: String(k * step) })) };
}
