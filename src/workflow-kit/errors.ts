import { z } from "zod";
import type { TaskId } from "../rules/identity/ids.js";

export interface TaskErrorOptions {
  readonly subject?: string;
  readonly transient?: boolean;
  readonly cause?: unknown;
}

export class TaskError<Code extends string = string> extends Error {
  readonly taskId: TaskId;
  readonly code: Code;
  readonly subject: string | undefined;
  readonly transient: boolean;

  constructor(taskId: TaskId, code: Code, message: string, options: TaskErrorOptions = {}) {
    super(`[${taskId}] ${code}: ${message}`, { cause: options.cause });
    this.name = "TaskError";
    this.taskId = taskId;
    this.code = code;
    this.subject = options.subject;
    this.transient = options.transient ?? false;
  }
}

export function wrapUnhandledTaskError(taskId: TaskId, error: unknown): TaskError<"unhandled"> {
  if (error instanceof Error || error instanceof z.ZodError) return new TaskError(taskId, "unhandled", error.message, { cause: error });
  return new TaskError(taskId, "unhandled", "task threw a non-Error value", { cause: error });
}

export function taskErrorCause(error: unknown): TaskError | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof TaskError) return current;
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}
