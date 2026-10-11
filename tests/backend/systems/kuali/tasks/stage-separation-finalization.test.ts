import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { stageSeparationFinalizationTask } from "../../../../../src/backend/systems/kuali/tasks/stage-separation-finalization.js";
import {
KualiMatchSeparationFinalization
} from "../../../../../src/models/systems/kuali/match-separation-finalization.js";
import { KualiStageSeparationFinalization } from "../../../../../src/models/systems/kuali/stage-separation-finalization.js";
import type { MutationCapability } from "../../../../../src/models/ui/driver.js";
import type { KualiRrssDocumentDriver } from "../../../../../src/models/ui/kuali-rrss-document.js";
import {
KualiFinalizationStagingSchema,
KualiFinalizationTargetSchema,
type KualiFinalizationTarget
} from "../../../../../src/models/ui/kuali-separation-finalization.js";
import type { DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";
import { taskFailer,type AnyTask } from "../../../../../src/workflow-kit/task.js";
const TARGET: KualiFinalizationTarget = KualiFinalizationTargetSchema.parse({
  actionId: "0123456789abcdef01234567",
  documentNumber: "4444",
  emplId: "10800000",
  variables: {
    department: "000412 - Housing/Dining/Hospitality",
    payrollTitleCode: "004921",
    payrollTitle: "STDT 2",
    timekeeperName: "Deterministic Timekeeper",
    lastDayWorked: "06/09/2026",
    separationDate: "06/10/2026",
    terminationEffectiveDate: "06/11/2026",
    transactionNumber: "T002209631",
    timekeeperComments: "Termination effective date set from the reconciled separation date.",
    observedExistingComments: "",
  },
});

const MATCH_EXAMPLE = KualiMatchSeparationFinalization.example;
if (MATCH_EXAMPLE.state !== "present") throw new Error("Kuali match example must carry a present proof");
const STAGING = KualiFinalizationStagingSchema.parse(KualiStageSeparationFinalization.example);

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

  describe("stageSeparationFinalizationTask", () => {
    it("returns the staged identity and fields without committing", async () => {
      const { driver, calls } = recordingDriver({
        stageSeparationFinalization: async () => STAGING,
      });
      const call = invocation(stageSeparationFinalizationTask, TARGET, driver);

      const result = await call.run();

      assert.deepEqual(result, STAGING);
      assert.deepEqual(calls, [{ operation: "stageSeparationFinalization", args: [TARGET] }]);
      assert.deepEqual(call.points, [
        point("read", "stagedPageState", STAGING.stagedPageState),
        point("read", "actionId", STAGING.actionId),
        point("read", "documentNumber", STAGING.documentNumber),
        point("read", "observedEid", STAGING.observedEid),
        point("read", "previousFields", STAGING.previousFields),
        point("write", "stagedFields", STAGING.stagedFields),
        point("read", "observedDepartmentOptions", STAGING.observedDepartmentOptions),
        point("read", "observedAt", STAGING.observedAt),
      ]);
    });
  });
});
