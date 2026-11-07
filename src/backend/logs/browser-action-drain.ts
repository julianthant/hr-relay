import { z } from "zod";
import type { BrowserAction } from "../systems/browser-shared/action-notes.js";

export type BrowserActionDrainStatus = Readonly<{
  attempted: number;
  failed: number;
  state: "delivered" | "append-failed" | "program-error";
  warningFailed: boolean;
}>;

function schemaFailure(error: unknown): boolean {
  if (error instanceof z.ZodError) return true;
  if (error instanceof AggregateError) return error.errors.some(schemaFailure)
    || (error.cause !== undefined && schemaFailure(error.cause));
  return error instanceof Error && error.cause !== undefined && schemaFailure(error.cause);
}

export function drainBrowserActionNotes(input: Readonly<{
  actions: readonly BrowserAction[];
  emitAction: (action: BrowserAction) => void;
  warn: () => void;
  onFailure?: (action: BrowserAction, error: unknown) => void;
}>): BrowserActionDrainStatus {
  let failed = 0;
  let programFailure = false;
  let warningFailed = false;
  for (const action of input.actions) {
    try { input.emitAction(action); }
    catch (error) {
      failed += 1;
      programFailure ||= schemaFailure(error);
      try { input.warn(); } catch { warningFailed = true; }
      input.onFailure?.(action, error);
    }
  }
  return { attempted: input.actions.length, failed,
    state: programFailure ? "program-error" : failed > 0 ? "append-failed" : "delivered",
    warningFailed };
}
