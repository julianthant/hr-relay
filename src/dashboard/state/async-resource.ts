/** The one shape every asynchronous read in the dashboard takes.
 * "Loading" and "failed" are DIFFERENT states from "loaded something empty" */
import { DashboardClientError } from "../client/errors.js";

export type AsyncResource<Value> =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "loaded"; readonly value: Value }
  | { readonly state: "failed"; readonly error: DashboardClientError };

export const IDLE = Object.freeze({ state: "idle" }) as AsyncResource<never>;
export const LOADING = Object.freeze({ state: "loading" }) as AsyncResource<never>;

export function loaded<Value>(value: Value): AsyncResource<Value> {
  return { state: "loaded", value };
}

export function failed<Value>(error: DashboardClientError): AsyncResource<Value> {
  return { state: "failed", error };
}

/** One effect-owned read. Cleanup revokes both settlement callbacks, including
 * an old rejection after a newer request has succeeded. The caller retains */
export function observeResource<Value>(
  read: () => Promise<Value>,
  onValue: (value: Value) => void,
  onError: (error: unknown) => void,
): () => void {
  let live = true;
  void read().then(
    (value) => { if (live) onValue(value); },
    (error: unknown) => { if (live) onError(error); },
  );
  return () => { live = false; };
}

/** Typed client failures are resource values; programming faults still escape. */
export function observeAsyncResource<Value>(
  read: () => Promise<Value>,
  settle: (resource: AsyncResource<Value>) => void,
): () => void {
  return observeResource(read, (value) => settle(loaded(value)), (error) => {
    if (error instanceof DashboardClientError) { settle(failed(error)); return; }
    throw error;
  });
}
