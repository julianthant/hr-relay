import type { MutationCapability } from "../domain/ui/driver.js";
import type { TaskId } from "../domain/ids.js";
import { TaskError } from "./errors.js";

export interface TaskLogger {
  readonly debug: (message: string, fields?: Readonly<Record<string, string | number | boolean>>) => void;
  readonly info: (message: string, fields?: Readonly<Record<string, string | number | boolean>>) => void;
  readonly warn: (message: string, fields?: Readonly<Record<string, string | number | boolean>>) => void;
}

export interface TaskCtxCommon<Codes extends readonly string[]> {
  readonly signal: AbortSignal;
  readonly log: TaskLogger;
  readonly fail: (
    code: Codes[number],
    message: string,
    options?: Readonly<{ subject?: string; transient?: boolean; cause?: unknown }>,
  ) => never;
}

export type PureTaskCtx<Codes extends readonly string[]> = TaskCtxCommon<Codes>;

export interface BrowserTaskCtx<Driver, Codes extends readonly string[]> extends TaskCtxCommon<Codes> {
  readonly driver: Driver;
}

export type ReadTaskCtx<Driver, Codes extends readonly string[]> = BrowserTaskCtx<Driver, Codes>;

export type PrepareTaskCtx<Driver, Codes extends readonly string[]> = BrowserTaskCtx<Driver, Codes>;

export interface CommitTaskCtx<Driver, Codes extends readonly string[]> extends BrowserTaskCtx<Driver, Codes> {
  readonly mutation: MutationCapability;
}

export function taskFailer<const Codes extends readonly string[]>(taskId: TaskId) {
  return (
    code: Codes[number],
    message: string,
    options?: Readonly<{ subject?: string; transient?: boolean; cause?: unknown }>,
  ): never => {
    throw new TaskError(taskId, code, message, options);
  };
}
