import { protectedSubjectDisplay, ProtectedSubjectDisplayRefusedError } from "../start/protected-input.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import type { ActorId } from "../../../rules/identity/ids.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { SpanEventWire } from "../../../models/events/types.js";
import { runSpanPath } from "../../logs/span-emitter.js";

type RunQueuedSpanEvent = Omit<Extract<SpanEventWire, { readonly t: "run.queued" }>, "pid">;

/** The one projection of a committed run identity into its write-once queue-root span. */
export function runQueuedSpanEvent(input: Readonly<{
  run: RunRecord;
  actorId: ActorId;
  title: string;
  subtitle?: string;
}>): RunQueuedSpanEvent {
  const { run } = input;
  const display = protectedSubjectDisplay(retainedRunProtectedBindings(run), () => input);
  if (input.title !== display.title || input.subtitle !== display.subtitle) throw new ProtectedSubjectDisplayRefusedError();
  return {
    t: "run.queued",
    kind: "run",
    ts: run.envelope.enqueuedAt,
    workflow: run.envelope.workflow,
    runId: run.envelope.runId,
    attempt: run.envelope.attempt,
    traceId: run.envelope.traceId,
    spanPath: runSpanPath(run.envelope.traceId),
    itemId: run.envelope.itemId,
    ...(run.envelope.parent === undefined ? {} : { parentRunId: run.envelope.parent.runId }),
    shape: run.envelope.shape,
    priority: run.envelope.priority,
    dryRun: run.envelope.dryRun,
    ...(run.envelope.stepOmissions === undefined
      ? {}
      : { omittedSteps: run.envelope.stepOmissions.map((entry) => entry.step) }),
    ...(run.envelope.retryOf === undefined ? {} : { retryOf: run.envelope.retryOf }),
    ...(run.envelope.recovery === undefined ? {} : { recovery: run.envelope.recovery }),
    actorId: input.actorId,
    title: input.title,
    ...(input.subtitle === undefined ? {} : { subtitle: input.subtitle }),
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint,
    resolvedInstance: run.envelope.resolvedInstance,
    configFingerprint: run.envelope.configFingerprint,
    configSnapshotId: run.envelope.configSnapshotId,
  };
}
