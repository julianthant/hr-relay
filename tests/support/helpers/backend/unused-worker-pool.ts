import type { WorkerPoolRuntimeSeam } from "../../../../src/backend/runs/commands/command-kernel.js";

/** A pool seam for suites that never send a worker command; every call fails through `fail`. */
export function unusedWorkerPool(fail: (...args: never[]) => unknown = () => { throw new Error("unexpected worker command"); }): WorkerPoolRuntimeSeam {
  const refuse = (): never => { fail(); throw new Error("unexpected worker command"); };
  return { admit: async () => refuse(), assertMember: refuse, start: async () => refuse(), ensure: async () => refuse(), stop: async () => refuse(),
    remove: async () => refuse(), direct: async () => refuse(), browser: async () => refuse(), checkParkedWrite: async () => refuse() };
}
