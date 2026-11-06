/** Contract identity, computed in memory from declared shapes only: browser-safe, no source reads. Code-only edits are covered by the build id on writes. */
import type { z } from "zod";
import type { AnyTaskContract } from "../models/task/task-contract.js";
import { deriveSchemaHash } from "../models/validation/schema-bound-value.js";
import { FingerprintSchema, type Fingerprint } from "../rules/identity/ids.js";
import { canonicalJsonStringify, type JsonValue } from "../rules/validation/canonical-json.js";
import { sha256Hex } from "../rules/validation/sha256.js";

/** Bump by hand when kit semantics change; it invalidates every stored contract identity. */
export const WORKFLOW_KIT_VERSION = 1;

type ContractShape = Pick<AnyTaskContract, "id" | "effect"> & Readonly<{ input: z.ZodType; output: z.ZodType }>;

const TASK_FINGERPRINTS = new WeakMap<object, Fingerprint>();

function taskIdentity(contract: ContractShape): JsonValue {
  return {
    id: String(contract.id),
    effect: contract.effect,
    input: deriveSchemaHash(contract.input, "input"),
    output: deriveSchemaHash(contract.output, "output"),
  };
}

export function taskImplFingerprint(contract: ContractShape): Fingerprint {
  const known = TASK_FINGERPRINTS.get(contract);
  if (known !== undefined) return known;
  const fingerprint = FingerprintSchema.parse(sha256Hex(
    `hrauto:task-identity:v1\0${canonicalJsonStringify({ kit: WORKFLOW_KIT_VERSION, task: taskIdentity(contract) })}`,
  ));
  TASK_FINGERPRINTS.set(contract, fingerprint);
  return fingerprint;
}

export function workflowContractFingerprint(input: Readonly<{
  id: string;
  version: number;
  input: z.ZodType;
  canonicalInput: z.ZodType;
  result: z.ZodType;
  graph: readonly Readonly<{ id: string; kind: string; dependsOn: readonly string[] }>[];
  contracts: readonly ContractShape[];
}>): Fingerprint {
  const tasks = [...new Map(input.contracts.map(contract => [String(contract.id), taskIdentity(contract)])).entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, identity]) => identity);
  return FingerprintSchema.parse(sha256Hex(`hrauto:workflow-contract:v1\0${canonicalJsonStringify({
    kit: WORKFLOW_KIT_VERSION,
    id: input.id,
    version: input.version,
    input: deriveSchemaHash(input.input, "input"),
    canonicalInput: deriveSchemaHash(input.canonicalInput, "output"),
    result: deriveSchemaHash(input.result, "output"),
    graph: input.graph.map(node => ({ id: node.id, kind: node.kind, dependsOn: [...node.dependsOn] })),
    tasks,
  })}`));
}
