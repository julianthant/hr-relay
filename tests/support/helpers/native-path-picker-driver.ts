import type { ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";

export function authorizeNativePickerDriver(original: ChildProcess, driverInput: Writable,
  requestSignal: AbortSignal, requestPending: boolean): boolean {
  const live = original.pid !== undefined && original.exitCode === null && original.signalCode === null
    && !original.killed && !requestSignal.aborted && requestPending;
  driverInput.end(live ? "AUTHORIZE\n" : "DENY\n");
  return live;
}
