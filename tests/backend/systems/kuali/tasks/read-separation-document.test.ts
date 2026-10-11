import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { readSeparationDocumentTask } from "../../../../../src/backend/systems/kuali/tasks/read-separation-document.js";
import {
KualiMatchSeparationFinalization
} from "../../../../../src/models/systems/kuali/match-separation-finalization.js";
import {
KualiReadSeparationDocument,
ReadSeparationDocumentOutputSchema,
} from "../../../../../src/models/systems/kuali/read-separation-document.js";
import type { MutationCapability } from "../../../../../src/models/ui/driver.js";
import type { KualiRrssDocumentDriver } from "../../../../../src/models/ui/kuali-rrss-document.js";
import type { DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";
import { taskFailer,type AnyTask } from "../../../../../src/workflow-kit/task.js";

const MATCH_EXAMPLE = KualiMatchSeparationFinalization.example;
if (MATCH_EXAMPLE.state !== "present") throw new Error("Kuali match example must carry a present proof");
const DOCUMENT = ReadSeparationDocumentOutputSchema.parse(KualiReadSeparationDocument.example);
const READ_INPUT = { actionId: DOCUMENT.actionId, documentNumber: DOCUMENT.documentNumber };

type KualiOperation =
  | "read"
  | "readActionListForDocument"
  | "readSeparationDocument"
  | "stageSeparationFinalization"
  | "readSavedSeparationFinalization"
  | "commit";
type OperationHandler = (...args: readonly unknown[]) => unknown;
type DriverCall = Readonly<{ operation: KualiOperation; args: readonly unknown[] }>;

function recordingDriver(handlers: Partial<Record<KualiOperation, OperationHandler>>) {
  const calls: DriverCall[] = [];
  const invoke = async (operation: KualiOperation, args: readonly unknown[]): Promise<unknown> => {
    calls.push({ operation, args });
    const handler = handlers[operation];
    if (handler === undefined) throw new Error(`unexpected Kuali semantic operation: ${operation}`);
    return handler(...args);
  };

  const driver = {
    system: "kuali",
    read: (id: unknown) => invoke("read", [id]),
    readActionListForDocument: (input: unknown) => invoke("readActionListForDocument", [input]),
    readSeparationDocument: (input: unknown) => invoke("readSeparationDocument", [input]),
    stageSeparationFinalization: (input: unknown) => invoke("stageSeparationFinalization", [input]),
    readSavedSeparationFinalization: (input: unknown) => invoke("readSavedSeparationFinalization", [input]),
    commit: (id: unknown, capability: unknown) => invoke("commit", [id, capability]),
  } as unknown as KualiRrssDocumentDriver;

  return { driver, calls };
}

function invocation(
  task: AnyTask,
  input: unknown,
  driver: KualiRrssDocumentDriver,
  mutation?: MutationCapability,
) {
  const points: DataPoint[] = [];
  const ctx = {
    signal: new AbortController().signal,
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
    fail: taskFailer(task.contract),
    recordData: (point: DataPoint | readonly DataPoint[]) => {
      if (Array.isArray(point)) points.push(...point as readonly DataPoint[]);
      else points.push(point as DataPoint);
    },
    driver,
    ...(mutation === undefined ? {} : { mutation }),
  };
  const parsedInput = task.contract.input.parse(input);
  return {
    points,
    run: () => task.impl.run({ input: parsedInput, ctx } as never),
  };
}

function point(direction: "read" | "write", field: string, value: unknown): DataPoint {
  return { direction, field, value };
}

describe("Kuali task wrappers at their semantic-driver boundary", () => {

  describe("readSeparationDocumentTask", () => {
    it("returns the RRSS document facts from one read-only operation", async () => {
      const { driver, calls } = recordingDriver({
        readSeparationDocument: async () => ({ state: "read", document: DOCUMENT }),
      });
      const call = invocation(readSeparationDocumentTask, READ_INPUT, driver);

      const result = await call.run() as typeof DOCUMENT;

      assert.equal(result.documentNumber, "4510");
      assert.equal(result.actionId, DOCUMENT.actionId);
      assert.deepEqual(result.employee.eid, DOCUMENT.employee.eid);
      assert.deepEqual(result.options, DOCUMENT.options);
      assert.deepEqual(calls, [{
        operation: "readSeparationDocument",
        args: [READ_INPUT],
      }]);
      assert.deepEqual(call.points, [
        point("read", "pageStateId", DOCUMENT.pageStateId),
        point("read", "actionId", DOCUMENT.actionId),
        point("read", "documentNumber", DOCUMENT.documentNumber),
        point("read", "formType", DOCUMENT.formType),
        point("read", "employee", DOCUMENT.employee),
        point("read", "separation", DOCUMENT.separation),
        point("read", "timekeeper", DOCUMENT.timekeeper),
        point("read", "finalTransactions", DOCUMENT.finalTransactions),
        point("read", "options", DOCUMENT.options),
        point("read", "observedAt", DOCUMENT.observedAt),
      ]);
    });
  });
});
