import { ERROR_CATALOG, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { DashboardClientError } from "./errors.js";

export const SETTINGS_READ_DEADLINE_MS = 10_000;
export const CHATGPT_ACCOUNT_READ_DEADLINE_MS = 30_000;
/** A rerun runs live detectors, each bounded by the server; this only ends a rerun that never answers. */
export const PREFLIGHT_RERUN_DEADLINE_MS = 60_000;
export const CHATGPT_COMPLETION_READ_DEADLINE_MS = 310_000;

const expiredReads = new WeakSet<Error>();
/** True for the error a read gets when its deadline passed before any answer. */
export const readDeadlineExpired = (error: unknown): boolean => error instanceof Error && expiredReads.has(error);

export function readWithDeadline<Value>(read: (signal: AbortSignal) => Promise<Value>, code: ErrorCatalogCode, milliseconds = SETTINGS_READ_DEADLINE_MS, signal?: AbortSignal): Promise<Value> {
  const controller = new AbortController();
  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      settle();
    };
    const fail = (reason: unknown): void => finish(() => reject(reason instanceof Error ? reason : new DashboardClientError({ kind: "network", code, message: ERROR_CATALOG[code].text, cause: reason })));
    const cancel = (): void => {
      controller.abort(signal?.reason);
      fail(signal?.reason ?? new DOMException("Read cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      controller.abort();
      const expired = new DashboardClientError({ kind: "network", code, message: ERROR_CATALOG[code].text });
      expiredReads.add(expired);
      finish(() => reject(expired));
    }, milliseconds);
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener("abort", cancel, { once: true });
    try { void read(controller.signal).then(value => finish(() => resolve(value)), (error: unknown) => fail(error)); }
    catch (error) { fail(error); }
  });
}
