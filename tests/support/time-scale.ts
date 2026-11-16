/** CI runners are slower than operator Macs; `RELAY_TEST_TIME_SCALE` stretches test waits and limits there. */
function readScale(): number {
  const raw = process.env["RELAY_TEST_TIME_SCALE"];
  if (raw === undefined || raw === "") return 1;
  const scale = Number(raw);
  if (!Number.isFinite(scale) || scale < 1 || scale > 10) throw new Error(`RELAY_TEST_TIME_SCALE must be a number from 1 to 10, got ${raw}`);
  return scale;
}

export const TEST_TIME_SCALE = readScale();

export function scaledMs(milliseconds: number): number {
  return Math.round(milliseconds * TEST_TIME_SCALE);
}
