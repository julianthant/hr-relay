import { UcpathReadPayPathPosition } from "../../../../models/systems/ucpath/read-paypath-position.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";

export const readPayPathPositionTask = defineTask(ucpathDriver, UcpathReadPayPathPosition, {
  screenshots: "task",
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    throw new Error(`not implemented: readPayPathPositionTask(${input.emplId}, ${String(ctx.signal.aborted)})`);
  },
});
