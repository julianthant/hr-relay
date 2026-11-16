import { DataPointSchema } from "../../../../src/rules/workflow/task-provenance.js";
import { TaskRefusal } from "../../helpers/separation-task-fixtures.js";

export function ocrTaskContext() {
  const recorded: unknown[] = [];
  const ctx = {
    signal: new AbortController().signal,
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    fail: (code: string, message: string): never => { throw new TaskRefusal(code, message); },
    recordData: (points: unknown): void => {
      recorded.push(...(Array.isArray(points) ? DataPointSchema.array().parse(points) : [DataPointSchema.parse(points)]));
    },
  };
  return { ctx, recorded };
}
