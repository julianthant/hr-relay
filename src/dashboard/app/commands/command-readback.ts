/** Waits before each read of a command's settled state after its outcome came back unknown. */
export const READBACK_WAITS_MS: readonly number[] = [0, 250, 750, 1500];

/** Reads until `settled` holds or the waits run out; the last good read wins, undefined when every read failed. */
export async function readBack<T>(read: () => Promise<T>, settled: (value: T) => boolean = () => true, waits = READBACK_WAITS_MS): Promise<T | undefined> {
  let last: T | undefined;
  for (const wait of waits) {
    await new Promise(resolve => setTimeout(resolve, wait));
    try { last = await read(); } catch { continue; }
    if (settled(last)) return last;
  }
  return last;
}
