import { AsyncLocalStorage } from "node:async_hooks";
import type { Clock } from "../../domain/clock.js";

export type BrowserActionKind = "opened" | "clicked" | "typed" | "selected" | "checked" | "set" | "cleared" | "pressed";
export interface BrowserAction {
  readonly kind: BrowserActionKind;
  readonly targetId: string;
  readonly at: string;
}

const MAX_BROWSER_ACTION_NOTES = 256;

interface Capture {
  readonly clock: Clock;
  readonly actions: BrowserAction[];
  active: boolean;
  truncated: boolean;
}

const scope = new AsyncLocalStorage<Capture>();

/** Record only a completed browser gesture. The target is a static semantic control id, never an input value. */
export function recordBrowserAction(kind: BrowserActionKind, targetId: string): void {
  const capture = scope.getStore();
  if (capture?.active !== true) return;
  if (capture.actions.length >= MAX_BROWSER_ACTION_NOTES) {
    capture.truncated = true;
    return;
  }
  capture.actions.push({ kind, targetId, at: capture.clock.now().toISOString() });
}

/** Drain after the operation settles so note I/O cannot enter a fenced write's click window. */
export async function withBrowserActionNotes<T>(
  clock: Clock,
  operation: () => Promise<T>,
  drain: (actions: readonly BrowserAction[], truncated: boolean) => void,
): Promise<T> {
  const capture: Capture = { clock, actions: [], active: true, truncated: false };
  return scope.run(capture, async () => {
    try {
      return await operation();
    } finally {
      capture.active = false;
      drain(capture.actions, capture.truncated);
    }
  });
}
