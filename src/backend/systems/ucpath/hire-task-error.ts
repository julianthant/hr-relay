import type { TaskCtxCommon } from "../../../workflow-kit/task.js";
import { TaskError } from "../../../workflow-kit/errors.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";

export async function runHireOperation<T>(ctx: TaskCtxCommon<readonly ["UCPATH_HIRE_REFUSED"]>, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (cause) {
    if (ctx.signal.aborted || cause instanceof TaskError) throw cause;
    return ctx.fail("UCPATH_HIRE_REFUSED", ERROR_CATALOG.UCPATH_HIRE_REFUSED.text, { cause });
  }
}
