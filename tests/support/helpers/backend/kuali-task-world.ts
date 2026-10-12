import { KualiMatchSeparationFinalization } from "../../../../src/models/systems/kuali/match-separation-finalization.js";
import { KualiReadSeparationDocument, ReadSeparationDocumentOutputSchema } from "../../../../src/models/systems/kuali/read-separation-document.js";
import { KualiStageSeparationFinalization } from "../../../../src/models/systems/kuali/stage-separation-finalization.js";
import { type MutationCapability } from "../../../../src/models/ui/driver.js";
import { type KualiRrssDocumentDriver } from "../../../../src/models/ui/kuali-rrss-document.js";
import { KualiFinalizationStagingSchema, KualiFinalizationTargetSchema, type KualiFinalizationTarget } from "../../../../src/models/ui/kuali-separation-finalization.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { type DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { taskFailer, type AnyTask } from "../../../../src/workflow-kit/task.js";

type KualiOperation =
  | "read"
  | "readActionListForDocument"
  | "readSeparationDocument"
  | "stageSeparationFinalization"
  | "readSavedSeparationFinalization"
  | "commit";

type OperationHandler = (...args: readonly unknown[]) => unknown;

type DriverCall = Readonly<{ operation: KualiOperation; args: readonly unknown[] }>;



export function recordingDriver(handlers: Partial<Record<KualiOperation, OperationHandler>>) {
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

export function invocation(
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

export function createKualiTaskTestWorld() {
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

  const STAGING = KualiFinalizationStagingSchema.parse(KualiStageSeparationFinalization.example);

  const DOCUMENT = ReadSeparationDocumentOutputSchema.parse(KualiReadSeparationDocument.example);

  const READ_INPUT = { actionId: DOCUMENT.actionId, documentNumber: DOCUMENT.documentNumber };





  function point(direction: "read" | "write", field: string, value: unknown): DataPoint {
    return { direction, field, value };
  }
  return { NOW, TARGET, MATCH_EXAMPLE, STAGING, READ_INPUT, recordingDriver, invocation, point, DOCUMENT };
}
