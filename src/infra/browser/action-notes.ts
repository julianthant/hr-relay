import { AsyncLocalStorage } from "node:async_hooks";
import type { Clock } from "../../domain/clock.js";
import type { DeclaredActionOccurrence } from "../../domain/task-provenance.js";

export type BrowserActionKind = "opened" | "clicked" | "typed" | "selected" | "checked" | "set" | "cleared" | "pressed";
export interface BrowserAction {
  readonly kind: BrowserActionKind;
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
}

const scope = new AsyncLocalStorage<Capture>();

/** Record a completed browser gesture with its static control id and entered value. */
export function recordBrowserAction(kind: BrowserActionKind, targetId: string, value?: string | boolean): void {
  const capture = scope.getStore();
  if (capture?.state.active !== true) return;
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
