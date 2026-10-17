import type { OperationInputLineage, OperationChildResultIdentity } from "../../../models/workflow/operation-action-identity.js";
/** Bind completed driver gestures to the immutable complete display for this run. */
import { canonicalJsonStringify, JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { ProtectedInputBinding } from "../../../models/write-safety/protected-input.js";
import {
  ActionValueProducerSchema,
  DeclaredActionOccurrenceSchema,
  type ActionValueProducer,
  type DeclaredActionIdentity,
} from "../../../rules/workflow/task-provenance.js";
import type { WorkflowDisplayTransformDeclaration, WorkflowValueReference } from "../../../models/workflow/operation-display.js";
import { OperationValueIdSchema } from "../../../models/workflow/operation-display.js";
import type { WorkflowOperationDisplaySnapshot } from "../../../models/workflow/operation-display-snapshot.js";
import type { BrowserAction, BrowserActionKind } from "../../systems/browser-shared/action-notes.js";

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
  readonly contractRole: "task" | "probe" | "prepare" | "commit" | "verify";
  readonly parsedInput: JsonValue;
  readonly protectedBindings: readonly ProtectedInputBinding[];
  readonly childSources?: Map<string, Readonly<{ result: OperationChildResultIdentity; inputs: readonly OperationInputLineage[] }>>;
  readonly transforms?: readonly WorkflowDisplayTransformDeclaration[];
  readonly runInput?: JsonValue;
  readonly outputs?: Readonly<Record<string, JsonValue>>;
  readonly configurationValues?: Readonly<Record<string, JsonValue>>;
  readonly sources?: Map<string, Readonly<{ identity: DeclaredActionIdentity; value: JsonValue; ambiguous?: true }>>;
  readonly childInvocation?: Readonly<{ parentRunId: string; edgeId: string }>;
  readonly allowPublishedValue?: (targetId: string, value: JsonValue) => boolean;
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
    case "cleared":
    case "screenshot": return [];
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

function findAction(
  actions: readonly SnapshotTaskAction[],
  observed: BrowserAction,
  operationPage: SnapshotInvocation["operation"]["page"],
): SnapshotTaskAction | undefined {
  const kinds = actionKindsFor(observed.kind);
  if (kinds.length === 0) return undefined;
  const candidates = actions.filter((candidate) => {
    if (observed.declaredActionId !== undefined && candidate.id !== observed.declaredActionId) return false;
    if (!kinds.includes(candidate.kind)) return false;
    if (candidate.kind === "open-page" || candidate.kind === "resume-page") {
      return (candidate.page?.screen ?? operationPage?.screen) === observed.targetId;
    }
    return (candidate.target ?? candidate.id) === observed.targetId;
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

function producer(reference: SnapshotWorkflowReference, consumed: JsonValue, input: DeclaredActionBinderInput): ActionValueProducer {
  const sources = input.sources;
  const source = reference.kind === "task-output" || reference.kind === "child-output" ? sources?.get(`${reference.entryId}/${reference.path}`) : undefined;
  const exactSource = source !== undefined && source.ambiguous !== true && (reference.kind !== "task-output" || source.identity.nodeId === reference.entryId) && canonicalJsonStringify(source.value) === canonicalJsonStringify(consumed) ? source.identity : undefined;
  switch (reference.kind) {
    case "run-input": return ActionValueProducerSchema.parse({ kind: reference.kind, path: reference.path });
    case "configuration": return ActionValueProducerSchema.parse({
      kind: reference.kind, key: reference.key, schemaHash: reference.schemaHash,
    });
    case "constant": return ActionValueProducerSchema.parse({ kind: reference.kind, valueDigest: reference.valueDigest });
    case "task-output":
      return ActionValueProducerSchema.parse({
        kind: reference.kind, entryId: reference.entryId, path: reference.path,
        ...(exactSource === undefined ? {} : { source: exactSource }),
      });
    case "transformation": {
      const transform = input.transforms?.find((candidate) => candidate.id === reference.transformId);
      if (transform === undefined) throw new Error("declared-action-transform-execution-unavailable");
      const active = new Set<string>();
      const resolve = (value: WorkflowValueReference): JsonValue => {
        switch (value.kind) {
          case "run-input": if (input.runInput === undefined) throw new Error("declared-action-transform-run-input-unavailable"); return readPath(input.runInput, value.path);
          case "constant": return JsonValueSchema.parse(value.value);
          case "configuration": { const configured = input.configurationValues?.[value.key]; if (configured === undefined) throw new Error("declared-action-transform-configuration-unavailable"); return JsonValueSchema.parse(value.schema.parse(configured)); }
          case "task-output": case "child-output": {
            const output = input.outputs?.[value.entryId]; if (output === undefined) throw new Error("declared-action-transform-output-unavailable");
            return readPath(value.kind === "child-output" ? readPath(output, "output") : output, value.path);
          }
          case "transformation": {
            const nested = input.transforms?.find((candidate) => candidate.id === value.transformId);
            if (nested === undefined) throw new Error("declared-action-transform-execution-unavailable");
            return readPath(execute(nested), value.path);
          }
        }
      };
      const execute = (declaration: WorkflowDisplayTransformDeclaration): JsonValue => {
        if (active.has(declaration.id)) throw new Error("declared-action-transform-cycle");
        active.add(declaration.id);
        const assembled: Record<string, unknown> = {};
        for (const source of declaration.inputs) {
          let container = assembled;
          const segments = source.inputPath.split(".");
          for (const segment of segments.slice(0, -1)) {
            if (!Object.hasOwn(container, segment)) container[segment] = {};
            container = Reflect.get(container, segment) as Record<string, unknown>;
          }
          container[segments.at(-1)!] = resolve(source.value);
        }
        const result = JsonValueSchema.parse(declaration.output.parse(declaration.derive(declaration.input.parse(assembled))));
        active.delete(declaration.id);
        return result;
      };
      if (canonicalJsonStringify(readPath(execute(transform), reference.path)) !== canonicalJsonStringify(consumed)) throw new Error("declared-action-transform-value-mismatch");
      const lineage = (value: WorkflowValueReference): readonly DeclaredActionIdentity[] | undefined => {
        if (value.kind === "task-output" || value.kind === "child-output") {
          const child = value.kind === "child-output" ? input.childSources?.get(`${value.entryId}/${value.path}`) : undefined;
          if (child !== undefined) {
            const identities = child.inputs.flatMap((input) => input.identity === undefined ? input.identities ?? [] : [input.identity]);
            if (child.inputs.some((input) => input.state === "unavailable")) return undefined;
            return identities;
          }
          const source = sources?.get(`${value.entryId}/${value.path}`);
          return source === undefined || source.ambiguous === true || (value.kind === "task-output" && source.identity.nodeId !== value.entryId) || canonicalJsonStringify(source.value) !== canonicalJsonStringify(resolve(value)) ? undefined : [source.identity];
        }
        if (value.kind === "transformation") {
          const nested = input.transforms?.find((candidate) => candidate.id === value.transformId);
          if (nested === undefined) return undefined;
          const inputs = nested.inputs.map((source) => lineage(source.value));
          return inputs.some((source) => source === undefined) ? undefined : inputs.flatMap((source) => source ?? []);
        }
        return [];
      };
      const childResults = (value: WorkflowValueReference): readonly Readonly<{ source: Extract<WorkflowValueReference, { kind: "child-output" }>; result: OperationChildResultIdentity }>[] => {
        if (value.kind === "child-output") {
          const child = input.childSources?.get(`${value.entryId}/${value.path}`);
          return child === undefined ? [] : [{ source: value, result: child.result }];
        }
        if (value.kind !== "transformation") return [];
        return input.transforms?.find((transform) => transform.id === value.transformId)?.inputs.flatMap((source) => childResults(source.value)) ?? [];
      };
      return ActionValueProducerSchema.parse({ kind: reference.kind, transformId: reference.transformId, path: reference.path,
        inputs: transform.inputs.map((source) => { const identities = lineage(source.value); return { inputId: source.id, childResults: childResults(source.value), source: input.snapshot.transforms.find((candidate) => candidate.id === transform.id)?.inputs.find((candidate) => candidate.id === source.id)?.value, identities: identities ?? [],
          ...(identities === undefined ? { state: "unavailable", reason: "exact-input-occurrence-not-retained" } : { state: identities.length === 0 ? "definition-source" : "retained" }) }; }) });
    }
    case "child-output":
      return ActionValueProducerSchema.parse({
        kind: reference.kind, entryId: reference.entryId, path: reference.path,
        ...(exactSource === undefined ? {} : { source: exactSource }),
        ...(input.childSources?.get(`${reference.entryId}/${reference.path}`) ?? {}),
      });
  }
}

function protectedBindingFor(path: string, bindings: readonly ProtectedInputBinding[]): ProtectedInputBinding | undefined {
  const root = path.split(".")[0];
  return bindings.find((binding) => binding.inputPath === root);
}

// Bind completed notes only; absent notes never become synthetic action outcomes.
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
  const pending = new Map<string, number>();
  const completed = new Map<string, Readonly<{ occurrence: number; at: string; sequence: number; physicalSessionId?: string }>>();
  const bindings = new Map(invocation.bindings.map((binding) => [binding.slot, binding.value]));
  const slots = new Map(invocation.operation.values.map((slot) => [slot.id, slot]));

  let sequence = 0;
  return (observed: BrowserAction): BrowserAction => {
    if (observed.operation !== undefined) throw new Error("declared-action-already-bound-reuse");
    sequence += 1;
    const declared = findAction(actions, observed, invocation.operation.page);
    if (declared === undefined) {
      if (observed.kind !== "cleared" && observed.kind !== "screenshot") {
        throw new Error(
          `browser action ${observed.kind} ${observed.targetId} is not declared for operation ${invocation.operation.id}`,
        );
      }
      return observed;
    }
    if (invocation.operation.session.kind === "browser" && observed.state !== "not-run" && observed.physicalSessionId === undefined) {
      throw new Error(`declared action ${declared.id} has no physical browser session incarnation`);
    }
    const finishing = observed.state === "completed" || observed.state === "failed";
    const occurrence = observed.state === "confirmed" ? completed.get(declared.id)?.occurrence : finishing ? pending.get(declared.id) : (counts.get(declared.id) ?? 0) + 1;
    if (occurrence === undefined) throw new Error(`declared action ${declared.id} finished without a recorded start`);
    if (observed.state === "started") {
      if (pending.has(declared.id)) throw new Error(`declared action ${declared.id} started concurrently within one invocation`);
      completed.delete(declared.id);
      pending.set(declared.id, occurrence);
    } else if (finishing) { pending.delete(declared.id); if (observed.state === "failed") completed.delete(declared.id); }
    counts.set(declared.id, occurrence);
    if (observed.state === "completed") completed.set(declared.id, { occurrence, at: observed.at, sequence, ...(observed.physicalSessionId === undefined ? {} : { physicalSessionId: observed.physicalSessionId }) });
    if (observed.state === "confirmed") {
      const proof = observed.confirmation;
      const verification = proof === undefined ? undefined : actions.find((candidate) => candidate.id === proof.verificationActionId && candidate.id === declared.confirmationActionId && candidate.kind === "verify");
      const retained = proof === undefined ? undefined : completed.get(proof.verificationActionId);
      if (verification === undefined || retained === undefined || retained.occurrence !== proof?.verificationOccurrence || retained.at !== proof.verifiedAt || retained.sequence <= completed.get(declared.id)!.sequence || retained.physicalSessionId !== completed.get(declared.id)!.physicalSessionId || observed.physicalSessionId !== retained.physicalSessionId) throw new Error("declared-action-confirmation-mismatch");
      completed.delete(declared.id);
    } else if (observed.confirmation !== undefined) throw new Error("declared-action-confirmation-state-mismatch");

    let value: unknown;
    let redactActionValue = observed.value !== undefined
      && !(input.allowPublishedValue?.(observed.targetId, observed.value) ?? true);
    if (declared.valueSlot !== undefined && (observed.state === undefined || observed.state === "completed" || observed.state === "confirmed")) {
      const slot = slots.get(OperationValueIdSchema.parse(declared.valueSlot));
      if (slot === undefined) throw new Error(`declared action ${declared.id} references missing value slot ${declared.valueSlot}`);
      if (observed.declaredValue === undefined && observed.value === undefined) {
        throw new Error(`declared action ${declared.id} completed without its observed field value`);
      }
      const consumed = JsonValueSchema.parse(observed.declaredValue ?? observed.value);
      const classified = input.allowPublishedValue?.(observed.targetId, consumed) ?? true;
      const protectionResolved = (reference: SnapshotWorkflowReference, depth = 0): boolean => {
        if (depth > 16) throw new Error("declared-action-protection-depth");
        if (reference.kind === "task-output" || reference.kind === "child-output") {
          const source = input.sources?.get(`${reference.entryId}/${reference.path}`);
          if (source !== undefined && source.ambiguous !== true && (reference.kind !== "task-output" || source.identity.nodeId === reference.entryId)) return true;
          const child = reference.kind === "child-output" ? input.childSources?.get(`${reference.entryId}/${reference.path}`) : undefined;
          return child !== undefined && child.inputs.every((input) => input.state === "retained");
        }
        if (reference.kind !== "transformation") return true;
        const transform = input.snapshot.transforms.find((transform) => transform.id === reference.transformId);
        return transform !== undefined && transform.inputs.every((input) => protectionResolved(input.value, depth + 1));
      };

      if (slot.source.kind === "contract-input") {
        const expected = readPath(input.parsedInput, slot.source.path);
        if (canonicalJsonStringify(expected) !== canonicalJsonStringify(consumed)) {
          throw new Error(
            `browser action ${observed.kind} ${observed.targetId} does not match declared field path ${slot.source.path}`,
          );
        }
        const bound = bindings.get(slot.id);
        if (bound === undefined) throw new Error(`declared action ${declared.id} has no immediate producer binding`);
        const referenceProtected = (reference: SnapshotWorkflowReference): ProtectedInputBinding | undefined => {
          if (reference.kind === "run-input") return protectedBindingFor(reference.path, input.protectedBindings);
          if (reference.kind !== "transformation") return undefined;
          return input.snapshot.transforms.find((candidate) => candidate.id === reference.transformId)?.inputs.map((source) => referenceProtected(source.value)).find((binding) => binding !== undefined);
        };
        const protectedBinding = protectedBindingFor(slot.source.path, input.protectedBindings) ?? referenceProtected(bound);
        redactActionValue ||= !classified || protectedBinding !== undefined || !protectionResolved(bound);
        value = {
          slot: slot.id,
          fieldPath: slot.source.path,
          producer: producer(bound, consumed, input),
          consumed: protectedBinding === undefined
            ? !classified ? { state: "withheld", reason: "classification-required" } : protectionResolved(bound) ? { state: "observed", value: consumed } : { state: "withheld", reason: "protection-unresolved" }
            : { state: "redacted", binding: protectedBinding },
        };
      } else {
        const protectedBinding = input.protectedBindings[0];
        const resolved = [...bindings.values()].every((reference) => protectionResolved(reference));
        redactActionValue ||= !classified || protectedBinding !== undefined || !resolved;
        value = {
          slot: slot.id,
          fieldPath: slot.source.path,
          producer: { kind: "task-output", entryId: input.nodeId, path: slot.source.path },
          consumed: protectedBinding === undefined ? !classified ? { state: "withheld", reason: "classification-required" } : resolved ? { state: "observed", value: consumed } : { state: "withheld", reason: "protection-unresolved" } : { state: "redacted", binding: protectedBinding },
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
      ...(observed.physicalSessionId === undefined ? {} : { physicalSessionId: observed.physicalSessionId }),
      ...(observed.state === undefined ? {} : { state: observed.state }),
      ...(observed.confirmation === undefined ? {} : { confirmation: observed.confirmation }),
      ...(observed.reason === undefined ? {} : { reason: observed.reason }),
      ...(value === undefined ? {} : { value }),
    });
    if (observed.state !== "confirmed" && operation.value?.producer.kind === "task-output" && operation.value.producer.entryId === input.nodeId
      && operation.value.consumed.state === "observed") {
      const { value: _value, ...identity } = operation;
      const key = `${input.nodeId}/${operation.value.fieldPath}`;
      const previous = input.sources?.get(key);
      input.sources?.set(key, { identity, value: operation.value.consumed.value, ...(previous === undefined ? {} : { ambiguous: true }) });
    }
    const { value: rawValue, declaredValue: _declaredValue, declaredActionId: _declaredActionId, state: _state, reason: _reason, confirmation: _confirmation, ...withoutRawValue } = observed;
    return {
      ...withoutRawValue,
      ...(redactActionValue || rawValue === undefined ? {} : { value: rawValue }),
      operation,
    };
  };
}
