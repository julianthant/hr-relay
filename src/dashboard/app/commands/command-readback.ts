/** Waits before each read of a command's settled state after its outcome came back unknown. */
export const READBACK_WAITS_MS: readonly number[] = [0, 250, 750, 1500];
/** A read that has not answered by then counts as failed, so a stalled read never holds a control. */
export const READBACK_READ_DEADLINE_MS = 3000;

/** `work`, or a READBACK_DEADLINE rejection once the deadline passes first. */
export async function withDeadline<T>(work: Promise<T>, ms = READBACK_READ_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("READBACK_DEADLINE")), ms); })]);
  } finally { clearTimeout(timer); }
}

/** Reads until `settled` holds or the waits run out; the last good read wins, undefined when every read failed. */
export async function readBack<T>(read: () => Promise<T>, settled: (value: T) => boolean = () => true, waits = READBACK_WAITS_MS): Promise<T | undefined> {
  let last: T | undefined;
  for (const wait of waits) {
    await new Promise(resolve => setTimeout(resolve, wait));
    try { last = await withDeadline(read()); } catch { continue; }
    if (settled(last)) return last;
  }
  return last;
}
