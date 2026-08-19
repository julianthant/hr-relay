/**
 * A task node's `when` — a DECLARED condition, not an opaque closure (D228).
 *
 * ## Why this is data
 *
 * Doc 12 §5.7 ruled that an authored closure is reported as its PRESENCE, never
 * as a decompiled rendering, and the explorer therefore printed the honest but
 * near-useless line *"runs when the descriptor's own when() predicate holds"*.
 * The recorded fix was an authored `whenLabel` beside the predicate, and that
 * fix has the defect this whole tree exists to avoid: two descriptions of one
 * rule, drifting the moment somebody edits the predicate and not the sentence.
 * A surface that says a node runs on a condition it no longer runs on is worse
 * than a surface that says nothing.
 *
 * So the condition itself becomes data. ONE declaration is evaluated by the
 * executor and rendered by the explorer, and the sentence cannot disagree with
 * the rule because it IS the rule. The vocabulary is closed and flat; a
 * condition it cannot express is a compile error in the descriptor rather than
 * a plausible sentence on the surface, and widening it is a reviewed code
 * change exactly as D104's branch-case names are.
 *
 * ## What was deliberately not built
 *
 * No `all-of` / `any-of`. A recursive condition tree is an expression language,
 * and shaping one against the ONE conditional node this tree has today is how
 * an authoring surface acquires the wrong shape (D186's own argument). The
 * union grows an arm when a second consumer asks for it.
 *
 * This module is browser-safe and pure: descriptors import it by value, and the
 * explorer's client renders through the same `describeNodeCondition`.
 */
import { z } from "zod";
import type { JsonObject, JsonValue } from "../canonical-json.js";
import { ContractFieldPathSchema } from "../contracts/base.js";
import { NodeIdSchema } from "../ids.js";

/**
 * Where a condition reads its value.
 *
 * `input` is the run's canonical input; `node` is an upstream node's output,
 * and the factory refuses one that is not in the node's own `dependsOn` — a
 * condition reading a node this one does not wait for would be read before it
 * had an answer.
 */
export const NodeConditionOperandSchema = z.discriminatedUnion("from", [
  z.strictObject({ from: z.literal("input"), path: ContractFieldPathSchema }),
  z.strictObject({ from: z.literal("node"), nodeId: NodeIdSchema, path: ContractFieldPathSchema }),
]);
export type NodeConditionOperand = z.infer<typeof NodeConditionOperandSchema>;

/** What a comparison arm may compare against — a JSON scalar, never a shape. */
export const NodeConditionValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type NodeConditionValue = z.infer<typeof NodeConditionValueSchema>;

/**
 * The closed condition vocabulary.
 *
 * `is-present` / `is-absent` are the ONLY arms that tolerate a path with no
 * value. Every other arm throws on one, because "the field the condition reads
 * is missing" and "the condition is false" are different facts, and letting the
 * first masquerade as the second is how a node silently stops running.
 */
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

/**
 * The AUTHORED face of a condition — plain strings, no brands.
 *
 * The same shape `WorkflowCapabilitiesSpec` takes for the same reason: the
 * builder parses the literal through `NodeConditionSchema`, so the brands are
 * enforced at definition time without every descriptor spelling a `.parse()`.
 */
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

/**
 * The condition in words — a projection of the declaration, never a second
 * authoring of it.
 *
 * The switch is exhaustive over a closed union, so a condition shape this
 * function cannot render is one a descriptor cannot spell. That is the refusal
 * doc 12 §5.7 asked for, moved from runtime to the type system.
 */
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

/**
 * The scope a condition is evaluated against.
 *
 * Structurally `RuntimeScope`, spelled inline rather than imported: `graph.ts`
 * imports THIS module for the node's `when` type, so importing back would be a
 * cycle. Both are JSON by construction — the canonical input and the parsed,
 * stored node outputs — which is what lets the walk below index safely instead
 * of asserting its way through an `unknown`.
 */
type NodeConditionScope = Readonly<{ input: JsonValue; outputs: JsonObject }>;

const ABSENT = Symbol("node-condition-absent");

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the operand, or `ABSENT`.
 *
 * A path that traverses a NON-object throws rather than reporting absence: a
 * condition asking for `selection.selected.emplId` of a string has been written
 * against a shape the contract does not have, and answering "absent" would let
 * a descriptor defect look like an ordinary false.
 */
function readOperand(
  operand: NodeConditionOperand,
  scope: NodeConditionScope,
): JsonValue | typeof ABSENT {
  const upstream = operand.from === "node" ? scope.outputs[String(operand.nodeId)] : undefined;
  if (operand.from === "node" && upstream === undefined) {
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

/**
 * Evaluate the declaration. The executor calls this and nothing else — there is
 * no second evaluator, so the sentence the explorer renders is a projection of
 * the rule this function applies.
 */
export function evaluateNodeCondition(
  condition: NodeCondition,
  scope: NodeConditionScope,
): boolean {
  const value = readOperand(condition.of, scope);
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
