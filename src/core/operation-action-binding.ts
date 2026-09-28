/** Bind completed driver gestures to the immutable complete display for this run. */
import { canonicalJsonStringify, JsonValueSchema } from "../domain/canonical-json.js";
import type { JsonValue } from "../domain/canonical-json.js";
import type { ProtectedInputBinding } from "../domain/protected-input.js";
import {
  ActionValueProducerSchema,
  DeclaredActionOccurrenceSchema,
  type ActionValueProducer,
} from "../domain/task-provenance.js";
import { OperationValueIdSchema } from "../domain/workflow/operation-display.js";
import type { WorkflowOperationDisplaySnapshot } from "../domain/workflow/operation-display-snapshot.js";
import type { BrowserAction, BrowserActionKind } from "../infra/browser/action-notes.js";

type SnapshotInvocation = WorkflowOperationDisplaySnapshot["invocations"][number];
type SnapshotTaskAction = SnapshotInvocation["operation"]["actions"][number];
type SnapshotWorkflowReference = SnapshotInvocation["bindings"][number]["value"];

export interface DeclaredActionBinderInput {
  readonly snapshot: WorkflowOperationDisplaySnapshot;
  readonly runId: string;
  readonly attempt: number;
  readonly claimGeneration: number;
  readonly taskAttempt: number;
  readonly nodeId: string;
  readonly taskId: string;
  readonly contractRole: "task" | "prepare" | "commit";
  readonly parsedInput: JsonValue;
  readonly protectedBindings: readonly ProtectedInputBinding[];
  readonly childInvocation?: Readonly<{ parentRunId: string; edgeId: string }>;
}

function flattenActions(actions: readonly SnapshotTaskAction[]): readonly SnapshotTaskAction[] {
  return actions.flatMap((action) => [action, ...flattenActions(action.children ?? [])]);
}

function actionKindsFor(kind: BrowserActionKind): readonly SnapshotTaskAction["kind"][] {
  switch (kind) {
    case "clicked": return ["click"];
    case "typed": return ["fill-field"];
    case "selected": return ["select-field"];
    case "checked":
    case "set": return ["check-field"];
    case "pressed": return ["keypress"];
    case "opened": return ["open-page", "resume-page"];
    // Clearing is a supporting gesture of a declared field fill, not a second
    // logical operation. A complete declaration never needs a fake clear node.
    case "cleared": return [];
  }
}

function findAction(
  actions: readonly SnapshotTaskAction[],
  observed: BrowserAction,
  operationPage: SnapshotInvocation["operation"]["page"],
): SnapshotTaskAction | undefined {
  const kinds = actionKindsFor(observed.kind);
  if (kinds.length === 0) return undefined;
  const candidates = actions.filter((candidate) => {
    if (!kinds.includes(candidate.kind)) return false;
    if (candidate.kind === "open-page" || candidate.kind === "resume-page") {
      return (candidate.page?.screen ?? operationPage?.screen) === observed.targetId;
    }
    return candidate.target === observed.targetId;
  });
  if (candidates.length > 1) {
    throw new Error(
      `browser action ${observed.kind} ${observed.targetId} resolves to multiple declared operation actions`,
    );
  }
  return candidates[0];
}

function readPath(value: JsonValue, path: string): JsonValue {
  let current = value;
  for (const segment of path.split(".")) {
    if (current === null || Array.isArray(current) || typeof current !== "object") {
      throw new Error(`declared action field path ${path} traverses a non-object at ${segment}`);
    }
    const next = (current as Readonly<Record<string, JsonValue>>)[segment];
    if (next === undefined) throw new Error(`declared action field path ${path} is unavailable for this invocation`);
    current = next;
  }
  return current;
}

function producer(reference: SnapshotWorkflowReference): ActionValueProducer {
  switch (reference.kind) {
    case "run-input": return ActionValueProducerSchema.parse({ kind: reference.kind, path: reference.path });
    case "configuration": return ActionValueProducerSchema.parse({
      kind: reference.kind, key: reference.key, schemaHash: reference.schemaHash,
    });
    case "constant": return ActionValueProducerSchema.parse({ kind: reference.kind, valueDigest: reference.valueDigest });
    case "task-output":
      return ActionValueProducerSchema.parse({
        kind: reference.kind, entryId: reference.entryId, path: reference.path,
      });
    case "transformation":
      return ActionValueProducerSchema.parse({
        kind: reference.kind, transformId: reference.transformId, path: reference.path,
      });
    case "child-output":
      return ActionValueProducerSchema.parse({
        kind: reference.kind, entryId: reference.entryId, path: reference.path,
      });
  }
}

function protectedBindingFor(path: string, bindings: readonly ProtectedInputBinding[]): ProtectedInputBinding | undefined {
  const root = path.split(".")[0];
  return bindings.find((binding) => binding.inputPath === root);
}

/**
 * A binder is scoped to one real task invocation and task retry. It observes
 * completed notes only; it never makes an absent note look started, failed, or
 * not-run.
 */
export function createDeclaredActionBinder(input: DeclaredActionBinderInput): (action: BrowserAction) => BrowserAction {
  const invocation = input.snapshot.invocations.find((candidate) =>
    candidate.entryId === input.nodeId
      && candidate.contractRole === input.contractRole
      && candidate.taskId === input.taskId);
  if (invocation === undefined) {
    throw new Error(
      `complete operation display has no ${input.contractRole} invocation for ${input.nodeId}/${input.taskId}`,
    );
  }
  const actions = flattenActions(invocation.operation.actions);
  const counts = new Map<string, number>();
  const bindings = new Map(invocation.bindings.map((binding) => [binding.slot, binding.value]));
  const slots = new Map(invocation.operation.values.map((slot) => [slot.id, slot]));

  return (observed: BrowserAction): BrowserAction => {
    const declared = findAction(actions, observed, invocation.operation.page);
    if (declared === undefined) {
      // Session/navigation and field-clear observations are real notes, but
      // they are not an action kind a declaration can claim. A typed/clicked
      // target that could be declared is never silently relabelled.
      if (observed.kind !== "cleared") {
        throw new Error(
          `browser action ${observed.kind} ${observed.targetId} is not declared for operation ${invocation.operation.id}`,
        );
      }
      return observed;
    }
    if (observed.physicalSessionId === undefined) {
      throw new Error(`declared action ${declared.id} has no physical browser session incarnation`);
    }
    const occurrence = (counts.get(declared.id) ?? 0) + 1;
    counts.set(declared.id, occurrence);

    let value: unknown;
    let redactActionValue = false;
    if (declared.valueSlot !== undefined) {
      const slot = slots.get(OperationValueIdSchema.parse(declared.valueSlot));
      if (slot === undefined) throw new Error(`declared action ${declared.id} references missing value slot ${declared.valueSlot}`);
      if (observed.value === undefined) {
        throw new Error(`declared action ${declared.id} completed without its observed field value`);
      }
      const consumed = JsonValueSchema.parse(observed.value);
      if (slot.source.kind === "contract-input") {
        const expected = readPath(input.parsedInput, slot.source.path);
        if (canonicalJsonStringify(expected) !== canonicalJsonStringify(consumed)) {
          throw new Error(
            `browser action ${observed.kind} ${observed.targetId} does not match declared field path ${slot.source.path}`,
          );
        }
        const bound = bindings.get(slot.id);
        if (bound === undefined) throw new Error(`declared action ${declared.id} has no immediate producer binding`);
        const protectedBinding = protectedBindingFor(slot.source.path, input.protectedBindings);
        redactActionValue = protectedBinding !== undefined;
        value = {
          slot: slot.id,
          fieldPath: slot.source.path,
          producer: producer(bound),
          consumed: protectedBinding === undefined
            ? { state: "observed", value: consumed }
            : { state: "redacted", binding: protectedBinding },
        };
      } else {
        value = {
          slot: slot.id,
          fieldPath: slot.source.path,
          producer: { kind: "task-output", entryId: input.nodeId, path: slot.source.path },
          consumed: { state: "observed", value: consumed },
        };
      }
    }
    const operation = DeclaredActionOccurrenceSchema.parse({
      runId: input.runId,
      definitionFingerprint: input.snapshot.definitionFingerprint,
      nodeId: input.nodeId,
      taskId: input.taskId,
      ...(input.childInvocation === undefined ? {} : { childInvocation: input.childInvocation }),
      attempt: input.attempt,
      claimGeneration: input.claimGeneration,
      taskAttempt: input.taskAttempt,
      invocationId: invocation.id,
      occurrencePath: invocation.occurrencePath,
      logicalActionId: declared.id,
      occurrence,
      logicalSessionId: invocation.operation.session.id,
      physicalSessionId: observed.physicalSessionId,
      ...(value === undefined ? {} : { value }),
    });
    const { value: rawValue, ...withoutRawValue } = observed;
    return {
      ...withoutRawValue,
      ...(redactActionValue || rawValue === undefined ? {} : { value: rawValue }),
      operation,
    };
  };
}
