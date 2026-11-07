/** A task node's `when` — a DECLARED condition, not an opaque closure, so the explorer can print the rule instead of its presence. */
import { z } from "zod";
import type { JsonObject, JsonValue } from "../../rules/validation/canonical-json.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import { NodeIdSchema } from "../../rules/identity/ids.js";

/** Conditions may read only declared dependencies, whose answers exist before execution. */
export const NodeConditionOperandSchema = z.discriminatedUnion("from", [
  z.strictObject({ from: z.literal("input"), path: ContractFieldPathSchema }),
  z.strictObject({ from: z.literal("node"), nodeId: NodeIdSchema, path: ContractFieldPathSchema }),
]);
export type NodeConditionOperand = z.infer<typeof NodeConditionOperandSchema>;

/** What a comparison arm may compare against — a JSON scalar, never a shape. */
export const NodeConditionValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type NodeConditionValue = z.infer<typeof NodeConditionValueSchema>;

/** The closed condition vocabulary; `is-present` / `is-absent` are the ONLY arms that tolerate a path with no value, because a missing field and a false condition are different facts. */
export const NodeConditionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("is-true"), of: NodeConditionOperandSchema }),
  z.strictObject({ kind: z.literal("is-false"), of: NodeConditionOperandSchema }),
  z.strictObject({
    kind: z.literal("equals"),
    of: NodeConditionOperandSchema,
    value: NodeConditionValueSchema,
  }),
  z.strictObject({
    kind: z.literal("not-equals"),
    of: NodeConditionOperandSchema,
    value: NodeConditionValueSchema,
  }),
  z.strictObject({ kind: z.literal("is-present"), of: NodeConditionOperandSchema }),
  z.strictObject({ kind: z.literal("is-absent"), of: NodeConditionOperandSchema }),
]);
export type NodeCondition = z.infer<typeof NodeConditionSchema>;

/** The AUTHORED face of a condition — plain strings, no brands, so the brands are enforced at definition time without every descriptor spelling a `.parse()`. */
export type NodeConditionOperandSpec =
  | Readonly<{ from: "input"; path: string }>
  | Readonly<{ from: "node"; nodeId: string; path: string }>;

export type NodeConditionSpec =
  | Readonly<{ kind: "is-true" | "is-false" | "is-present" | "is-absent"; of: NodeConditionOperandSpec }>
  | Readonly<{ kind: "equals" | "not-equals"; of: NodeConditionOperandSpec; value: NodeConditionValue }>;

/** Parse an authored condition into its branded runtime value, or throw. */
export function parseNodeCondition(spec: NodeConditionSpec): NodeCondition {
  return Object.freeze(NodeConditionSchema.parse(spec));
}

/** The upstream node a condition reads, when it reads one. */
export function nodeConditionDependency(condition: NodeCondition): string | undefined {
  return condition.of.from === "node" ? String(condition.of.nodeId) : undefined;
}

/** The operand, in the words an operator reads it in. */
function describeOperand(operand: NodeConditionOperand): string {
  return operand.from === "input"
    ? `the run's input field ${String(operand.path)}`
    : `${String(operand.nodeId)}'s output field ${String(operand.path)}`;
}

function describeValue(value: NodeConditionValue): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}

/** The condition in words — a projection of the declaration, never a second authoring of it; the switch is exhaustive, so the refusal lives in the type system. */
export function describeNodeCondition(condition: NodeCondition): string {
  const subject = describeOperand(condition.of);
  switch (condition.kind) {
    case "is-true": return `runs when ${subject} is true`;
    case "is-false": return `runs when ${subject} is false`;
    case "equals": return `runs when ${subject} is exactly ${describeValue(condition.value)}`;
    case "not-equals": return `runs when ${subject} is anything but ${describeValue(condition.value)}`;
    case "is-present": return `runs when ${subject} carries a value`;
    case "is-absent": return `runs when ${subject} carries no value`;
  }
}

/** The scope a condition is evaluated against, spelled inline rather than imported so the graph module does not import back into a cycle. */
type NodeConditionScope = Readonly<{ input: JsonValue; outputs: JsonObject }>;

const ABSENT = Symbol("node-condition-absent");

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the operand, or `ABSENT`; a path that traverses a NON-object throws rather than reporting absence, so a descriptor defect cannot look like an ordinary false. */
function readOperand(
  operand: NodeConditionOperand,
  scope: NodeConditionScope,
  tolerateMissingUpstream = false,
): JsonValue | typeof ABSENT {
  const upstream = operand.from === "node" ? scope.outputs[String(operand.nodeId)] : undefined;
  if (operand.from === "node" && upstream === undefined) {
    if (tolerateMissingUpstream) return ABSENT;
    throw new Error(
      `node condition reads ${describeOperand(operand)}, but that node produced no output in this scope`,
    );
  }
  let current: JsonValue | undefined = operand.from === "input" ? scope.input : upstream;
  for (const segment of String(operand.path).split(".")) {
    if (current === null || current === undefined) return ABSENT;
    if (!isJsonObject(current)) {
      throw new Error(
        `node condition path ${String(operand.path)} traverses a non-object at "${segment}"`,
      );
    }
    current = current[segment];
  }
  return current === undefined ? ABSENT : current;
}

/** Evaluate the declaration; the executor calls this and nothing else, so the sentence the explorer renders is a projection of the rule this function applies. */
export function evaluateNodeCondition(
  condition: NodeCondition,
  scope: NodeConditionScope,
): boolean {
  const value = readOperand(condition.of, scope, condition.kind === "is-present" || condition.kind === "is-absent");
  if (condition.kind === "is-present") return value !== ABSENT && value !== null;
  if (condition.kind === "is-absent") return value === ABSENT || value === null;
  if (value === ABSENT) {
    throw new Error(
      `node condition reads ${describeOperand(condition.of)}, which is absent; `
      + "use is-present / is-absent when a missing value is the question",
    );
  }
  switch (condition.kind) {
    case "is-true":
    case "is-false": {
      if (typeof value !== "boolean") {
        throw new Error(
          `node condition reads ${describeOperand(condition.of)} as a boolean, but it holds a `
          + `${typeof value}; refusing to guess whether the node runs`,
        );
      }
      return condition.kind === "is-true" ? value : !value;
    }
    case "equals": return value === condition.value;
    case "not-equals": return value !== condition.value;
  }
}
