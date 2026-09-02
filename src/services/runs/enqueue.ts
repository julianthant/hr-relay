/**
 * Minting a queued run from a descriptor and a parsed input.
 *
 * One place builds run records, because two would eventually disagree about
 * which fingerprints get stamped. Both doors into the queue — a confirmed start
 * plan and an operator retry — come through here.
 */
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import type { JsonValue } from "../../domain/canonical-json.js";
import { IsoInstantSchema } from "../../domain/ids.js";
import type { BrowserPresentationMode, InstanceSelection, RunParent, RunPriority, RunShape } from "../../domain/run/envelope.js";
import type { StepOmissions } from "../../domain/workflow/step-omission.js";
import { RunEnvelopeSchema } from "../../domain/run/envelope.js";
import { RunRecordSchema } from "../../domain/run/record.js";
import type { RunRecord } from "../../domain/run/record.js";
import type { SchemaBoundCanonicalValue } from "../../domain/schema-bound-value.js";
import type { AnyWorkflowDescriptor } from "../../base/workflow.js";

export interface QueuedRunSpec {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly runId: string;
  readonly itemId: string;
  readonly traceId: string;
  /** Exactly what the operator submitted, before ingress defaults were applied. */
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
  /**
   * D221 — the ITEM's next attempt, read from authority inside the transaction
   * that inserts this run. It is required rather than defaulted to 1 because a
   * default would be a claim about the item's history that this function cannot
   * see, and a wrong one collides with a stored checkpoint rather than failing.
   */
  readonly attempt: number;
  /**
   * D230 — the WORKFLOW's next unspent ordinal, read from authority inside the
   * transaction that inserts this run. Required for `attempt`'s reason one
   * scope up: a default would be a claim about the workflow's history this
   * function cannot see, and a wrong one is refused by `enqueue` rather than
   * silently naming a run somebody else already named.
   */
  readonly runNumber: number;
  /** The running app build, stamped at enqueue and never rewritten (D179). */
  readonly appVersion: string;
  readonly now: string;
}

export function buildQueuedRun(spec: QueuedRunSpec): RunRecord {
  const enqueuedAt = IsoInstantSchema.parse(spec.now);
  const envelope = RunEnvelopeSchema.parse({
    runId: spec.runId,
    workflow: spec.descriptor.id,
    itemId: spec.itemId,
    traceId: spec.traceId,
    descriptorVersion: spec.descriptor.version,
    contractFingerprint: spec.descriptor.contractFingerprint,
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
