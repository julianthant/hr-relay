
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import type { BrowserPresentationMode, InstanceSelection, RunParent, RunPriority, RunShape } from "../../../models/run/envelope.js";
import type { StepOmissions } from "../../../models/workflow/step-omission.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../../models/workflow/operation-display-snapshot.js";
import { RunEnvelopeSchema } from "../../../models/run/envelope.js";
import { RunRecordSchema } from "../../../models/run/record.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { SchemaBoundCanonicalValue } from "../../../models/validation/schema-bound-value.js";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";

export interface QueuedRunSpec {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly runId: string;
  readonly itemId: string;
  readonly traceId: string;
  // Preserve the submitted ingress before applying defaults.
  readonly rawInput: JsonValue;
  readonly canonicalInput: SchemaBoundCanonicalValue;
  readonly ingressSchemaHash: string;
  readonly configFingerprint: string;
  readonly configSnapshotId: string;
  readonly requestedInstance?: InstanceSelection;
  readonly resolvedInstance: InstanceSelection;
  readonly shape: RunShape;
  readonly priority: RunPriority;
  readonly dryRun: boolean;
  readonly browserMode?: BrowserPresentationMode;
  readonly captureBrowserScreenshots?: boolean;
  readonly stepOmissions?: StepOmissions;
  readonly parent?: RunParent;
  readonly retryOf?: string;

  readonly attempt: number;

  readonly runNumber: number;

  readonly appVersion: string;
  readonly now: string;
}

export function buildQueuedRun(spec: QueuedRunSpec): RunRecord {
  const enqueuedAt = IsoInstantSchema.parse(spec.now);
  const operationDisplaySnapshot = freezeWorkflowOperationDisplaySnapshot({
    workflowId: spec.descriptor.id,
    definitionFingerprint: spec.descriptor.contractFingerprint,
    display: spec.descriptor.operationDisplay,
  });
  const envelope = RunEnvelopeSchema.parse({
    runId: spec.runId,
    workflow: spec.descriptor.id,
    itemId: spec.itemId,
    traceId: spec.traceId,
    descriptorVersion: spec.descriptor.version,
    contractFingerprint: spec.descriptor.contractFingerprint,
    operationDisplayCapability: operationDisplaySnapshot === undefined ? "legacy" : "complete",
    ...(operationDisplaySnapshot === undefined ? {} : { operationDisplaySnapshot }),
    ...(spec.requestedInstance === undefined ? {} : { requestedInstance: spec.requestedInstance }),
    resolvedInstance: spec.resolvedInstance,
    configFingerprint: spec.configFingerprint,
    configSnapshotId: spec.configSnapshotId,
    ...(spec.parent === undefined ? {} : { parent: spec.parent }),
    shape: spec.shape,
    priority: spec.priority,
    dryRun: spec.dryRun,
    ...(spec.browserMode === undefined ? {} : { browserMode: spec.browserMode }),
    ...(spec.captureBrowserScreenshots === undefined ? {} : { captureBrowserScreenshots: spec.captureBrowserScreenshots }),
    ...(spec.stepOmissions === undefined ? {} : { stepOmissions: spec.stepOmissions }),
    ...(spec.retryOf === undefined ? {} : { retryOf: spec.retryOf }),
    attempt: spec.attempt,
    enqueuedAt,
  });
  return RunRecordSchema.parse({
    envelope,
    input: {
      raw: spec.rawInput,
      parsed: spec.canonicalInput,
      ingressSchemaHash: spec.ingressSchemaHash,
    },
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    appVersion: spec.appVersion,
    runNumber: spec.runNumber,
    version: 1,
    createdAt: enqueuedAt,
    updatedAt: enqueuedAt,
  });
}

/** The canonical-JSON digest input a start plan fingerprints its proposals with. */
export function plannedInputDigestSource(inputs: readonly SchemaBoundCanonicalValue[]): string {
  return canonicalJsonStringify(inputs);
}
