import { AsyncLocalStorage } from "node:async_hooks";
import type { JsonValue } from "../../domain/canonical-json.js";
import type { Clock } from "../../domain/clock.js";
import type { DeclaredActionOccurrence } from "../../domain/task-provenance.js";

export type BrowserActionKind = "opened" | "clicked" | "typed" | "selected" | "checked" | "set" | "cleared" | "pressed" | "read" | "computed" | "verified" | "branched" | "joined" | "gated" | "delegated" | "session";
export interface BrowserAction {
  readonly kind: BrowserActionKind;
  readonly declaredActionId?: string;
  readonly state?: "started" | "completed" | "failed" | "not-run" | "confirmed";
  readonly confirmation?: NonNullable<DeclaredActionOccurrence["confirmation"]>;
  readonly reason?: "condition-false" | "dry-run" | "cancelled" | "callback-failed";
  readonly declaredValue?: JsonValue;
  readonly targetId: string;
  readonly at: string;
  readonly value?: string | boolean;
  /** Physical browser incarnation, captured by the existing driver lease. */
  readonly physicalSessionId?: string;
  /** Added only after a frozen complete declaration resolves this gesture. */
  readonly operation?: DeclaredActionOccurrence;
}

/** A pure attribution check run at the completed driver gesture, before durability. */
export type BrowserActionBinder = (action: BrowserAction) => BrowserAction;

interface CaptureState { active: boolean; }

interface Capture {
  readonly clock: Clock;
  readonly actions: BrowserAction[];
  readonly state: CaptureState;
  readonly physicalSessionId?: string;
  readonly bind?: BrowserActionBinder;
  readonly executingAction?: Readonly<{ kind: BrowserActionKind; targetId: string }>;
}

const scope = new AsyncLocalStorage<Capture>();

/** Record a completed browser gesture with its static control id and entered value. */
export function recordBrowserAction(kind: BrowserActionKind, targetId: string, value?: string | boolean): void {
  const capture = scope.getStore();
  if (capture?.state.active !== true) return;
  if (capture.executingAction?.kind === kind && capture.executingAction.targetId === targetId) return;
  const action: BrowserAction = {
    kind,
    targetId,
    at: capture.clock.now().toISOString(),
    ...(value === undefined ? {} : { value }),
    ...(capture.physicalSessionId === undefined ? {} : { physicalSessionId: capture.physicalSessionId }),
  };
  capture.actions.push(capture.bind === undefined ? action : capture.bind(action));
}

/** Attach the current manager lease identity without opening a second telemetry scope. */
export async function withBrowserActionSession<T>(
  physicalSessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const capture = scope.getStore();
  if (capture === undefined) return await operation();
  return await scope.run({ ...capture, physicalSessionId }, operation);
}

/**
 * Attribute only the driver gestures produced by one bounded task role. The
 * binder is pure and runs after each completed gesture; note persistence still
 * drains after the enclosing operation settles.
 */
export async function withBrowserActionBinding<T>(
  bind: BrowserActionBinder | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const capture = scope.getStore();
  if (capture === undefined || bind === undefined) return await operation();
  return await scope.run({ ...capture, bind }, operation);
}

/** Drain after the operation settles so note I/O cannot enter a fenced write's click window. */
export async function withBrowserActionNotes<T>(
  clock: Clock,
  operation: () => Promise<T>,
  drain: (actions: readonly BrowserAction[]) => void,
): Promise<T> {
  const capture: Capture = { clock, actions: [], state: { active: true } };
  return scope.run(capture, async () => {
    try {
      return await operation();
    } finally {
      capture.state.active = false;
      drain(capture.actions);
    }
  });
}

/** Executes the existing callback; all evidence stays buffered until settlement. */
export async function runDeclaredAction<T>(
  action: Readonly<{ id: string; kind: BrowserActionKind; targetId: string }>,
  operation: () => Promise<T>,
  consumed?: (result: T) => JsonValue,
  confirmation?: Readonly<{ id: string; targetId: string; verify: (result: T) => Promise<boolean> }>,
): Promise<T> {
  const capture = scope.getStore();
  if (capture?.state.active !== true || capture.bind === undefined) {
    const result = await operation();
    if (confirmation !== undefined && !await confirmation.verify(result)) throw new Error("declared-action-effect-not-confirmed");
    return result;
  }
  const record = (state: BrowserAction["state"], value?: JsonValue): void => {
    capture.actions.push(capture.bind!({
      kind: action.kind, targetId: action.targetId, declaredActionId: action.id,
      at: capture.clock.now().toISOString(), state,
      ...(capture.physicalSessionId === undefined ? {} : { physicalSessionId: capture.physicalSessionId }),
      ...(state === "failed" ? { reason: "callback-failed" as const } : {}),
      ...(value === undefined ? {} : { declaredValue: value }),
    }));
  };
  record("started");
  let result: T;
  try { result = await scope.run({ ...capture, executingAction: action }, operation); }
  catch (error) {
    try { record("failed"); }
    catch (recordError) { throw new AggregateError([error, recordError], "declared action and failure attribution both failed", { cause: recordError }); }
    throw error;
  }
  const observedValue = consumed?.(result);
  record("completed", observedValue);
  if (confirmation !== undefined) {
    await runDeclaredAction({ id: confirmation.id, kind: "verified", targetId: confirmation.targetId }, async () => {
      if (!await confirmation.verify(result)) throw new Error("declared-action-effect-not-confirmed");
    });
    const verification = capture.actions.at(-1)?.operation;
    if (verification === undefined || verification.logicalActionId !== confirmation.id || verification.state !== "completed") throw new Error("declared-action-confirmation-identity-missing");
    capture.actions.push(capture.bind({ kind: action.kind, targetId: action.targetId, declaredActionId: action.id,
      at: capture.clock.now().toISOString(), state: "confirmed",
      confirmation: { verificationActionId: verification.logicalActionId, verificationOccurrence: verification.occurrence, verifiedAt: capture.actions.at(-1)!.at },
      ...(capture.physicalSessionId === undefined ? {} : { physicalSessionId: capture.physicalSessionId }),
      ...(observedValue === undefined ? {} : { declaredValue: observedValue }),
    }));
  }
  return result;
}

/** Only an explicit control decision can establish that an action did not run. */
export function recordDeclaredActionNotRun(
  action: Readonly<{ id: string; kind: BrowserActionKind; targetId: string }>,
  reason: "condition-false" | "dry-run" | "cancelled",
): void {
  const capture = scope.getStore();
  if (capture?.state.active !== true || capture.bind === undefined) return;
  capture.actions.push(capture.bind({
    kind: action.kind, targetId: action.targetId, declaredActionId: action.id,
    at: capture.clock.now().toISOString(), state: "not-run", reason,
    ...(capture.physicalSessionId === undefined ? {} : { physicalSessionId: capture.physicalSessionId }),
  }));
}
