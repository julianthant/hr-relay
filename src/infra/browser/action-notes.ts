import { AsyncLocalStorage } from "node:async_hooks";
import type { Clock } from "../../domain/clock.js";

export type BrowserActionKind = "opened" | "clicked" | "typed" | "selected" | "checked" | "set" | "cleared" | "pressed";
export interface BrowserAction {
  readonly kind: BrowserActionKind;
  readonly targetId: string;
  readonly at: string;
  readonly value?: string | boolean;
}

interface Capture {
  readonly clock: Clock;
  readonly actions: BrowserAction[];
  active: boolean;
}

const scope = new AsyncLocalStorage<Capture>();

/** Record a completed browser gesture with its static control id and entered value. */
export function recordBrowserAction(kind: BrowserActionKind, targetId: string, value?: string | boolean): void {
  const capture = scope.getStore();
  if (capture?.active !== true) return;
  capture.actions.push({ kind, targetId, at: capture.clock.now().toISOString(), ...(value === undefined ? {} : { value }) });
}

/** Drain after the operation settles so note I/O cannot enter a fenced write's click window. */
export async function withBrowserActionNotes<T>(
  clock: Clock,
  operation: () => Promise<T>,
  drain: (actions: readonly BrowserAction[]) => void,
): Promise<T> {
  const capture: Capture = { clock, actions: [], active: true };
  return scope.run(capture, async () => {
    try {
      return await operation();
    } finally {
      capture.active = false;
      drain(capture.actions);
    }
  });
}
