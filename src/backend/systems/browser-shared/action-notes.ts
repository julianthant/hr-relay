import { AsyncLocalStorage } from "node:async_hooks";
import type { Clock } from "../../../rules/time/clock.js";

export type BrowserActionKind = "opened" | "clicked" | "typed" | "selected" | "checked" | "set" | "cleared" | "pressed" | "read" | "computed" | "verified" | "branched" | "joined" | "gated" | "delegated" | "session" | "screenshot";
export interface BrowserAction {
  readonly kind: BrowserActionKind;
  readonly targetId: string;
  readonly at: string;
  readonly value?: string | boolean;
  /** Physical browser incarnation, captured by the existing driver lease. */
  readonly physicalSessionId?: string;
}

interface CaptureState { active: boolean; }

interface Capture {
  readonly clock: Clock;
  readonly actions: BrowserAction[];
  readonly state: CaptureState;
  readonly physicalSessionId?: string;
  readonly onAction?: (action: BrowserAction) => void;
}

const scope = new AsyncLocalStorage<Capture>();

export function currentBrowserActionSessionId(): string | undefined {
  const capture = scope.getStore();
  return capture?.state.active === true ? capture.physicalSessionId : undefined;
}

/** Record a completed browser gesture with its static control id and entered value. */
export function recordBrowserAction(kind: BrowserActionKind, targetId: string, value?: string | boolean): boolean {
  const capture = scope.getStore();
  if (capture?.state.active !== true) return false;
  const action: BrowserAction = {
    kind,
    targetId,
    at: capture.clock.now().toISOString(),
    ...(value === undefined ? {} : { value }),
    ...(capture.physicalSessionId === undefined ? {} : { physicalSessionId: capture.physicalSessionId }),
  };
  capture.actions.push(action);
  capture.onAction?.(action);
  return true;
}

/** Authentication remains in Sessions while the enclosing task owns its action scope. */
export async function withoutBrowserActionNotes<T>(operation: () => Promise<T>): Promise<T> {
  return await scope.exit(operation);
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

/** Drain after the operation settles so note I/O cannot enter a fenced write's click window. */
export async function withBrowserActionNotes<T>(
  clock: Clock,
  operation: () => Promise<T>,
  drain: (actions: readonly BrowserAction[]) => void,
  onAction?: (action: BrowserAction) => void,
): Promise<T> {
  const capture: Capture = { clock, actions: [], state: { active: true }, onAction };
  return scope.run(capture, async () => {
    let outcome: Readonly<{ state: "succeeded"; value: T }> | Readonly<{ state: "failed"; error: unknown }>;
    try { outcome = { state: "succeeded", value: await operation() }; }
    catch (error) { outcome = { state: "failed", error }; }
    capture.state.active = false;
    try { drain(capture.actions); }
    catch (error) {
      if (outcome.state === "failed") throw new AggregateError([outcome.error, error], "browser operation and action persistence both failed", { cause: error });
      throw error;
    }
    if (outcome.state === "failed") throw outcome.error;
    return outcome.value;
  });
}
