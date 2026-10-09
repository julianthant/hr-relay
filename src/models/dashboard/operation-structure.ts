import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
/** One browser-safe structure vocabulary for the static Explorer and the retained, observed Logs view; the definition is the immutable operation snapshot. */
import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { z } from "zod";
import { IsoInstantSchema, NoteIdSchema, RunIdSchema } from "../../rules/identity/ids.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import { ProtectedInputBindingSchema } from "../write-safety/protected-input.js";
import { ActionValueProducerSchema, DeclaredActionIdentitySchema } from "../../rules/workflow/task-provenance.js";
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
  "read", "computed", "verified", "branched", "joined", "gated", "delegated", "session",
]);

/** Logs retain exact source identity but do not promote a raw driver value to a new operator surface; protected input stays redacted. */
const OperationActionValueWireSchema = z.strictObject({
  slot: OperationValueIdSchema,
  fieldPath: ContractFieldPathSchema,
  producer: ActionValueProducerSchema,
  state: z.enum(["redacted", "withheld", "observed"]),
  value: JsonValueSchema.optional(),
  classification: z.literal("local-operator").optional(),
  binding: ProtectedInputBindingSchema.optional(),
  reason: z.string().min(1).optional(),
}).superRefine((value, context) => {
  if (value.state === "observed" && (value.value === undefined || value.classification !== "local-operator" || value.binding !== undefined || value.reason !== undefined)) {
    context.addIssue({ code: "custom", message: "observed action value requires explicit local-operator classification" });
  }
  if (value.state !== "observed" && (value.value !== undefined || value.classification !== undefined)) {
    context.addIssue({ code: "custom", message: "withheld/redacted action value cannot expose a value" });
  }
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

const OperationActionOccurrenceWireSchema = DeclaredActionIdentitySchema
  .safeExtend({ value: OperationActionValueWireSchema.optional() });

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

export function requireOperationSourceDeclaration(
  definition: z.infer<typeof WorkflowOperationDisplaySnapshotSchema>,
  identity: z.infer<typeof OperationActionOccurrenceWireSchema>,
): void {
  const invocation = definition.invocations.find((candidate) => candidate.id === identity.invocationId
    && candidate.entryId === identity.nodeId && candidate.taskId === identity.taskId
    && canonicalJsonStringify(candidate.occurrencePath) === canonicalJsonStringify(identity.occurrencePath));
  if (invocation === undefined) throw new Error("operation-source-unknown-frozen-invocation");
  if (!actionsWithChildren(invocation.operation.actions).some((action) => action.id === identity.logicalActionId)) throw new Error("operation-source-unknown-frozen-action");
  if (identity.logicalSessionId !== invocation.operation.session.id
    || (invocation.operation.session.kind === "browser" && identity.state !== "not-run" && identity.physicalSessionId === undefined)) throw new Error("operation-source-frozen-session-mismatch");
  if ((identity.state === "failed" && identity.reason !== "callback-failed")
    || (identity.state === "not-run" && (identity.reason === undefined || identity.reason === "callback-failed"))
    || ((identity.state === undefined || identity.state === "started" || identity.state === "completed" || identity.state === "confirmed") && identity.reason !== undefined)) throw new Error("operation-source-lifecycle-reason-mismatch");
}

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
    case "read": return ["read-field"];
    case "computed": return ["compute"];
    case "verified": return ["verify"];
    case "branched": return ["branch"];
    case "joined": return ["join"];
    case "gated": return ["operator-gate"];
    case "delegated": return ["delegate"];
    case "session": return ["session-lifecycle"];
  }
}

/** A Logs projection is only valid when every retained action occurrence resolves to one exact frozen invocation/action; it refuses unknown joins. */
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
      String(occurrence.claimGeneration),
      String(occurrence.taskAttempt),
      String(occurrence.occurrence),
      occurrence.state ?? "completed",
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
    if (occurrence.logicalSessionId !== invocation.operation.session.id
      || (invocation.operation.session.kind === "browser" && occurrence.state !== "not-run" && occurrence.physicalSessionId === undefined)) {
      context.addIssue({ code: "custom", path: ["observations", index, "occurrence", "logicalSessionId"], message: "operation observation session does not match its frozen invocation" });
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
    if ((occurrence.state === "confirmed") !== (occurrence.confirmation !== undefined)
      || (occurrence.confirmation !== undefined && !actionsWithChildren(invocation.operation.actions).some((candidate) => candidate.kind === "verify" && candidate.id === occurrence.confirmation?.verificationActionId && action.confirmationActionId === candidate.id))) {
      context.addIssue({ code: "custom", path: ["observations", index, "occurrence", "confirmation"], message: "operation confirmation requires an exact frozen verification action" });
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
      : action.target ?? action.id;
    if (expectedTarget !== observation.targetId) {
      context.addIssue({
        code: "custom",
        path: ["observations", index, "targetId"],
        message: "operation observation target does not match its frozen action",
      });
    }
    const producer = occurrence.value?.producer;
    if (producer?.kind === "transformation") {
      const transform = structure.definition.transforms.find((candidate) => candidate.id === producer.transformId);
      if (transform === undefined || (producer.inputs !== undefined && (producer.inputs.length !== transform.inputs.length
        || new Set(producer.inputs.map((input) => input.inputId)).size !== producer.inputs.length
        || producer.inputs.some((input) => {
          const declared = transform.inputs.find((candidate) => candidate.id === input.inputId);
          if (declared === undefined || (input.source !== undefined && canonicalJsonStringify(input.source) !== canonicalJsonStringify(declared.value))) return true;
          const sources = (reference: typeof declared.value): readonly typeof declared.value[] => reference.kind === "transformation"
            ? structure.definition.transforms.find((transform) => transform.id === reference.transformId)?.inputs.flatMap((nested) => sources(nested.value)) ?? [] : [reference];
          const leaves = sources(declared.value);
          if (input.childResults?.some((child) => !leaves.some((source) => canonicalJsonStringify(source) === canonicalJsonStringify(child.source)))) return true;
          if (declared.value.kind !== "task-output") return false;
          const source = declared.value;
          return input.identities.some((identity) => {
            if (identity.nodeId !== source.entryId || identity.definitionFingerprint !== structure.definition.definitionFingerprint || (identity.state !== undefined && identity.state !== "completed")) return true;
            const invocation = structure.definition.invocations.find((invocation) => invocation.id === identity.invocationId && invocation.entryId === source.entryId && invocation.taskId === identity.taskId);
            const action = invocation === undefined ? undefined : actionsWithChildren(invocation.operation.actions).find((action) => action.id === identity.logicalActionId);
            const slot = invocation?.operation.values?.find((slot) => slot.id === action?.valueSlot);
            return slot?.source.kind !== "contract-output" || slot.source.path !== source.path;
          });
        })))) {
        context.addIssue({ code: "custom", path: ["observations", index, "occurrence", "value", "producer"], message: "transformation lineage does not match frozen declared inputs" });
      }
    }
    if (producer?.kind === "child-output" && producer.inputs !== undefined && producer.result === undefined) context.addIssue({ code: "custom", message: "child lineage requires its immediate retained result identity" });
    if ((occurrence.state === undefined || occurrence.state === "completed" || occurrence.state === "confirmed") && occurrence.value?.slot !== action.valueSlot) {
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

export const OperationSourceRequestSchema = z.strictObject({
  identity: DeclaredActionIdentitySchema,
  cursor: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
});
export type OperationSourceRequest = z.infer<typeof OperationSourceRequestSchema>;

export const OperationSourceResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("found"), structure: ObservedOperationStructureWireSchema }),
  z.strictObject({ state: z.literal("continue"), cursor: OperationSourceRequestSchema.shape.cursor.unwrap() }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.literal("exact-occurrence-not-retained") }),
]);
export type OperationSourceResponse = z.infer<typeof OperationSourceResponseSchema>;
