import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { searchSeparationActionTask } from "../../../../../src/backend/systems/kuali/tasks/search-separation-action.js";
import {
KualiMatchSeparationFinalization
} from "../../../../../src/models/systems/kuali/match-separation-finalization.js";
import type { MutationCapability } from "../../../../../src/models/ui/driver.js";
import type { KualiRrssDocumentDriver } from "../../../../../src/models/ui/kuali-rrss-document.js";
import {
KualiFinalizationTargetSchema,
type KualiFinalizationTarget
} from "../../../../../src/models/ui/kuali-separation-finalization.js";
import { IsoInstantSchema } from "../../../../../src/rules/identity/ids.js";
import type { DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";
import { taskFailer,type AnyTask } from "../../../../../src/workflow-kit/task.js";

const NOW = IsoInstantSchema.parse("2026-08-20T17:24:11.000Z");
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
  describe("searchSeparationActionTask", () => {
    it("returns the uniquely resolved document and records the observed Action List facts", async () => {
      const actionHref = "/build/space/5e47518b90adda9474c14adb/actions/0123456789abcdef01234567";
      const observation = {
        pageStateId: "kuali.action-list.ready",
        space: "5e47518b90adda9474c14adb",
        requestedDocumentNumber: TARGET.documentNumber,
        matchedLinks: [
          { name: TARGET.documentNumber, href: actionHref },
          { name: TARGET.documentNumber, href: actionHref },
        ],
        listedDocumentNumbers: [TARGET.documentNumber],
        observedAt: NOW,
      };
      const { driver, calls } = recordingDriver({
        readActionListForDocument: async () => observation,
      });
      const call = invocation(searchSeparationActionTask, { documentNumber: TARGET.documentNumber }, driver);

      const result = await call.run();

      assert.deepEqual(result, {
        pageStateId: "kuali.action-list.ready",
        documentNumber: TARGET.documentNumber,
        actionId: TARGET.actionId,
        actionHref,
        matchedLinkCount: 2,
        observedAt: NOW,
      });
      assert.deepEqual(calls, [{
        operation: "readActionListForDocument",
        args: [{ documentNumber: TARGET.documentNumber }],
      }]);
      assert.deepEqual(call.points, [
        point("read", "documentNumber", TARGET.documentNumber),
        point("read", "actionId", TARGET.actionId),
        point("read", "actionHref", actionHref),
        point("read", "matchedLinkCount", 2),
        point("read", "pageStateId", "kuali.action-list.ready"),
        point("read", "observedAt", NOW),
      ]);
    });
  });
});
