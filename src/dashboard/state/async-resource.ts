/**
 * The one shape every asynchronous read in the dashboard takes.
 *
 * "Loading" and "failed" are DIFFERENT states from "loaded something empty" —
 * collapsing them is how a dashboard comes to render a confident empty queue
 * because a request died. The error arm keeps the `DashboardClientError`
 * itself, so a surface can show the server's own words and its retryability
 * rather than a generic apology.
 */
import type { DashboardClientError } from "../client/index.js";

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
