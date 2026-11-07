type DurableIntentView =
  | { readonly status: "committed" | "observed-present" }
  | { readonly status: "attempting"; readonly runId: string; readonly runAttempt: number }
  | { readonly status: "parked" }
  | { readonly status: "retryable"; readonly generation: number; readonly version: number };

type DurableIntentDecision<T extends DurableIntentView> =
  | { readonly kind: "fence"; readonly generation: number; readonly expectedVersion: number | undefined }
  | { readonly kind: "reuse"; readonly record: Extract<T, { status: "committed" | "observed-present" }> }
  | { readonly kind: "recover-own"; readonly record: Extract<T, { status: "attempting" }> }
  | { readonly kind: "refuse-foreign"; readonly record: Extract<T, { status: "attempting" }> }
  | { readonly kind: "refuse-parked"; readonly record: Extract<T, { status: "parked" }> };

export function decideDurableIntent<T extends DurableIntentView>(
  durable: T | undefined,
  owner: Readonly<{ runId: string; runAttempt: number }>,
): DurableIntentDecision<T> {
  if (durable === undefined) return { kind: "fence", generation: 1, expectedVersion: undefined };
  if (durable.status === "committed" || durable.status === "observed-present") {
    return { kind: "reuse", record: durable as Extract<T, { status: "committed" | "observed-present" }> };
  }
  if (durable.status === "attempting") {
    const record = durable as Extract<T, { status: "attempting" }>;
    return durable.runId === owner.runId && durable.runAttempt === owner.runAttempt
      ? { kind: "recover-own", record }
      : { kind: "refuse-foreign", record };
  }
  if (durable.status === "parked") {
    return { kind: "refuse-parked", record: durable as Extract<T, { status: "parked" }> };
  }
  if (durable.status === "retryable") {
    return { kind: "fence", generation: durable.generation + 1, expectedVersion: durable.version };
  }
  throw new Error("unexpected durable intent status");
}
