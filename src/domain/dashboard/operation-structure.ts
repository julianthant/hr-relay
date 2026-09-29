/**
 * One browser-safe structure vocabulary for the static Explorer and the
 * retained, observed Logs view.  The definition is the immutable operation
 * snapshot, never today's registry reconstructed for a historical run.
 */
import { z } from "zod";
import { IsoInstantSchema, NoteIdSchema, RunIdSchema } from "../ids.js";
import { ContractFieldPathSchema } from "../contracts/base.js";
import { ProtectedInputBindingSchema } from "../protected-input.js";
import { ActionValueProducerSchema, DeclaredActionOccurrenceSchema } from "../task-provenance.js";
import { OperationValueIdSchema } from "../workflow/operation-display.js";
import { WorkflowOperationDisplaySnapshotSchema } from "../workflow/operation-display-snapshot.js";

const BrowserActionKindSchema = z.enum([
  "opened",
  "clicked",
  "typed",
  "selected",
  "checked",
  "set",
  "cleared",
  "pressed",
]);

/**
 * Logs retain exact source identity but do not promote a raw driver value to a
 * new operator surface. Protected input stays redacted; other raw captures
 * need a later explicit presentation classification before they can be shown.
 */
const OperationActionValueWireSchema = z.strictObject({
  slot: OperationValueIdSchema,
  fieldPath: ContractFieldPathSchema,
  producer: ActionValueProducerSchema,
  state: z.enum(["redacted", "withheld"]),
  binding: ProtectedInputBindingSchema.optional(),
  reason: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.state === "redacted" && value.binding === undefined) {
    context.addIssue({ code: "custom", path: ["binding"], message: "redacted action value requires its protected binding" });
  }
  if (value.state === "withheld" && value.reason === undefined) {
    context.addIssue({ code: "custom", path: ["reason"], message: "withheld action value requires a reason" });
  }
  if (value.state === "redacted" && value.reason !== undefined) {
    context.addIssue({ code: "custom", path: ["reason"], message: "redacted action value cannot carry a withholding reason" });
  }
  if (value.state === "withheld" && value.binding !== undefined) {
    context.addIssue({ code: "custom", path: ["binding"], message: "withheld action value cannot carry a protected binding" });
  }
});

const OperationActionOccurrenceWireSchema = DeclaredActionOccurrenceSchema
  .omit({ value: true })
  .extend({ value: OperationActionValueWireSchema.optional() });

/** A complete declaration served by Explorer, or honest legacy absence. */
export const ExplorerOperationStructureWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("declared"),
    definition: WorkflowOperationDisplaySnapshotSchema,
  }),
  z.strictObject({
    state: z.literal("legacy"),
    reason: z.string().min(1),
  }),
]);
export type ExplorerOperationStructureWire = z.infer<typeof ExplorerOperationStructureWireSchema>;

/** One completed driver gesture, addressed against a retained definition. */
export const OperationActionObservationWireSchema = z.strictObject({
  logId: NoteIdSchema,
  at: IsoInstantSchema,
  action: BrowserActionKindSchema,
  targetId: z.string().min(1),
  occurrence: OperationActionOccurrenceWireSchema,
});
export type OperationActionObservationWire = z.infer<typeof OperationActionObservationWireSchema>;

function actionsWithChildren(
  actions: readonly z.infer<typeof WorkflowOperationDisplaySnapshotSchema>["invocations"][number]["operation"]["actions"][number][],
): readonly z.infer<typeof WorkflowOperationDisplaySnapshotSchema>["invocations"][number]["operation"]["actions"][number][] {
  return actions.flatMap((action) => [action, ...actionsWithChildren(action.children ?? [])]);
}

function declaredKindsFor(observed: z.infer<typeof BrowserActionKindSchema>): readonly string[] {
  switch (observed) {
    case "clicked": return ["click"];
    case "typed": return ["fill-field"];
    case "selected": return ["select-field"];
    case "checked":
    case "set": return ["check-field"];
    case "pressed": return ["keypress"];
    case "opened": return ["open-page", "resume-page"];
    // A clear is a supporting driver gesture. It never receives a declared
    // occurrence, so an at-rest note that claims one is corrupt.
    case "cleared": return [];
  }
}

/**
 * A Logs projection is only valid when every retained action occurrence
 * resolves to one exact frozen invocation/action.  It refuses unknown joins
 * instead of matching a similarly named current workflow action.
 */
export const ObservedOperationStructureWireSchema = z.strictObject({
  state: z.literal("observed"),
  runId: RunIdSchema,
  definition: WorkflowOperationDisplaySnapshotSchema,
  observations: z.array(OperationActionObservationWireSchema),
}).superRefine((structure, context) => {
  const logIds = new Set<string>();
  const occurrenceIds = new Set<string>();
  for (const [index, observation] of structure.observations.entries()) {
    if (logIds.has(observation.logId)) {
      context.addIssue({ code: "custom", path: ["observations", index, "logId"], message: "operation observation repeats a log id" });
    }
    logIds.add(observation.logId);
    const occurrence = observation.occurrence;
    const occurrenceId = [
      occurrence.runId,
      occurrence.invocationId,
      occurrence.logicalActionId,
      String(occurrence.attempt),
      String(occurrence.taskAttempt),
      String(occurrence.occurrence),
    ].join("\\0");
    if (occurrenceIds.has(occurrenceId)) {
      context.addIssue({
        code: "custom",
        path: ["observations", index, "occurrence", "occurrence"],
        message: "operation observation repeats one exact action occurrence",
      });
    }
    occurrenceIds.add(occurrenceId);
    if (occurrence.runId !== structure.runId) {
      context.addIssue({
        code: "custom",
        path: ["observations", index, "occurrence", "runId"],
        message: "operation observation belongs to a different run",
      });
    }
    if (occurrence.definitionFingerprint !== structure.definition.definitionFingerprint) {
      context.addIssue({
        code: "custom",
        path: ["observations", index, "occurrence", "definitionFingerprint"],
        message: "operation observation does not match the frozen definition fingerprint",
      });
    }
    const invocation = structure.definition.invocations.find((candidate) =>
      candidate.id === occurrence.invocationId
        && candidate.entryId === occurrence.nodeId
        && candidate.taskId === occurrence.taskId
        && candidate.occurrencePath.length === occurrence.occurrencePath.length
        && candidate.occurrencePath.every((segment, segmentIndex) => segment === occurrence.occurrencePath[segmentIndex]));
    if (invocation === undefined) {
      context.addIssue({
        code: "custom",
        path: ["observations", index, "occurrence", "invocationId"],
        message: "operation observation references no frozen invocation",
      });
      continue;
    }
    const action = actionsWithChildren(invocation.operation.actions)
      .find((candidate) => candidate.id === occurrence.logicalActionId);
    if (action === undefined) {
      context.addIssue({
        code: "custom",
        path: ["observations", index, "occurrence", "logicalActionId"],
        message: "operation observation references no frozen action",
      });
      continue;
    }
    if (!declaredKindsFor(observation.action).includes(action.kind)) {
      context.addIssue({
        code: "custom",
        path: ["observations", index, "action"],
        message: "operation observation kind does not match its frozen action",
      });
    }
    const expectedTarget = action.kind === "open-page" || action.kind === "resume-page"
      ? action.page?.screen ?? invocation.operation.page?.screen
      : action.target;
    if (expectedTarget !== observation.targetId) {
      context.addIssue({
        code: "custom",
        path: ["observations", index, "targetId"],
        message: "operation observation target does not match its frozen action",
      });
    }
    if (occurrence.value?.slot !== action.valueSlot) {
      context.addIssue({
        code: "custom",
        path: ["observations", index, "occurrence", "value", "slot"],
        message: "operation observation value binding does not match its frozen action",
      });
    }
  }
});
export type ObservedOperationStructureWire = z.infer<typeof ObservedOperationStructureWireSchema>;

/** The run-side mode; legacy records retain the existing truthful log reader. */
export const RunOperationStructureWireSchema = z.discriminatedUnion("state", [
  ObservedOperationStructureWireSchema,
  z.strictObject({
    state: z.literal("legacy"),
    reason: z.string().min(1),
  }),
]);
export type RunOperationStructureWire = z.infer<typeof RunOperationStructureWireSchema>;
