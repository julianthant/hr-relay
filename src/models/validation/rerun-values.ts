import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../rules/validation/canonical-json.js";
import type { RerunValueMapping, RerunValueMappingSpec } from "../workflow/rerun-values.js";
import { RerunValueMappingsSchema } from "../workflow/rerun-values.js";
import type { RuntimeFlowNode } from "../workflow/graph.js";
import type { StepOmissionSpec } from "../workflow/step-omission.js";
import { stepOmissionFactsSchema } from "../workflow/step-omission.js";
import { assertSchemaOffersPath } from "./contract-boundary.js";

/** Resolve declared leaves only. Preserve leaf wrappers and union alternatives. */
function leafSchemas(schema: z.core.$ZodType, path: readonly string[]): readonly z.core.$ZodType[] {
  if (path.length === 0) return [schema];
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodReadonly
    || schema instanceof z.ZodDefault || schema instanceof z.ZodCatch || schema instanceof z.ZodNonOptional) {
    return leafSchemas(schema.unwrap(), path);
  }
  if (schema instanceof z.ZodUnion) return schema.options.flatMap((option) => leafSchemas(option, path));
  if (!(schema instanceof z.ZodObject)) return [];
  const [key, ...rest] = path;
  if (key === undefined || !Object.hasOwn(schema.shape, key)) return [];
  const child: unknown = schema.shape[key];
  if (!(child instanceof z.ZodType)) throw new Error("RERUN_MAPPING_TARGET_SCHEMA_INVALID");
  return leafSchemas(child, rest);
}

export interface RerunMappingView {
  readonly input: z.ZodType;
  readonly stepOmissions: readonly StepOmissionSpec[];
}

export function rerunTargetSchema(view: RerunMappingView, mapping: RerunValueMapping): z.ZodType {
  if (mapping.targetStepKey === undefined) return view.input;
  const step = view.stepOmissions.find(({ step }) => step === mapping.targetStepKey);
  if (step === undefined) throw new Error("RERUN_MAPPING_TARGET_STEP_MISSING");
  return stepOmissionFactsSchema(step.form);
}

/** A candidate is never coerced into a different value by this read. */
export function rerunTargetAccepts(view: RerunMappingView, mapping: RerunValueMapping, value: JsonValue): boolean {
  if (leafSchemas(rerunTargetSchema(view, mapping), mapping.targetFieldPath.split(".")).length === 0) throw new Error("RERUN_MAPPING_TARGET_FIELD_MISSING");
  return rerunInputFieldAccepts(rerunTargetSchema(view, mapping), mapping.targetFieldPath, value);
}

export function rerunInputFieldAccepts(schema: z.ZodType, path: string, value: JsonValue): boolean {
  return leafSchemas(schema, path.split(".")).some((schema) => {
    const parsed = z.core.safeParse(schema, value);
    return parsed.success && canonicalJsonStringify(parsed.data) === canonicalJsonStringify(value);
  });
}

/** Transaction coordinates address the durable wrapper, not an invented bare output. */
export function rerunSourceFieldSchema(node: RuntimeFlowNode, fieldPath: string): { schema: z.ZodType; path: string } {
  if (node.kind === "task") return { schema: node.uses.output, path: fieldPath };
  if (node.kind === "transaction") {
    if (fieldPath.startsWith("output.value.")) return { schema: node.commit.uses.output, path: fieldPath.slice("output.value.".length) };
    if (fieldPath.startsWith("proof.value.")) return { schema: node.commit.uses.writeSafety.completion.proofSchema, path: fieldPath.slice("proof.value.".length) };
  }
  throw new Error("RERUN_MAPPING_SOURCE_NOT_A_VALUE");
}

export function validateRerunValueMappings(view: RerunMappingView & {
  readonly nodes: readonly RuntimeFlowNode[];
  readonly protectedInputs?: readonly Readonly<{ inputPath: string }>[];
}, input: readonly RerunValueMappingSpec[]): readonly RerunValueMapping[] {
  const mappings = RerunValueMappingsSchema.parse(input);
  for (const mapping of mappings) {
    const node = view.nodes.find(({ id }) => id === mapping.nodeId);
    if (node === undefined) throw new Error("RERUN_MAPPING_SOURCE_NODE_MISSING");
    const source = rerunSourceFieldSchema(node, mapping.fieldPath);
    assertSchemaOffersPath(source.schema, source.path, "Rerun source field");
    const target = rerunTargetSchema(view, mapping);
    if (leafSchemas(target, mapping.targetFieldPath.split(".")).length === 0) throw new Error("RERUN_MAPPING_TARGET_FIELD_MISSING");
    if (mapping.targetFieldPath.split(".").includes("timekeeperName")
      || (mapping.targetStepKey === undefined && view.protectedInputs?.some(({ inputPath }) =>
        mapping.targetFieldPath === inputPath || mapping.targetFieldPath.startsWith(`${inputPath}.`)))) {
      throw new Error("RERUN_MAPPING_TARGET_PROTECTED");
    }
  }
  return Object.freeze(mappings.map((mapping) => Object.freeze(mapping)));
}
