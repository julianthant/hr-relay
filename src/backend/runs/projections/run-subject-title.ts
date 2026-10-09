
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";

/** The narrow authority read this needs — ref workflow-model §5.7's "latest compatible attempt wins". */
export interface SubjectCheckpointSource {
  latestCheckpoint(
    workflowId: string,
    itemId: string,
    nodeId: string,
  ): RunCheckpointRecord | undefined;
}

/** The declared address, as the broad descriptor view carries it. */
export interface SubjectProjectionAddress {
  readonly nodeId: string;
  readonly fieldPath: string;
}

function isJsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type LeafLookup = { kind: "absent" } | { kind: "value"; value: JsonValue };


function leafAtPath(output: JsonValue, fieldPath: string): LeafLookup {
  let current: JsonValue = output;
  for (const part of fieldPath.split(".")) {
    if (!isJsonRecord(current) || !Object.hasOwn(current, part)) return { kind: "absent" };
    const next = current[part];
    if (next === undefined) return { kind: "absent" };
    current = next;
  }
  return { kind: "value", value: current };
}


export function resolveSubjectTitle(
  subjectProjection: SubjectProjectionAddress | undefined,
  identity: Readonly<{ workflowId: string; itemId: string }>,
  authority: SubjectCheckpointSource,
): string | undefined {
  if (subjectProjection === undefined) return undefined;
  const { nodeId, fieldPath } = subjectProjection;
  const stored = authority.latestCheckpoint(identity.workflowId, identity.itemId, nodeId);
  if (stored === undefined) return undefined;
  const leaf = leafAtPath(stored.output.value, fieldPath);
  if (leaf.kind === "absent") return undefined;
  if (typeof leaf.value !== "string") {
    throw new Error(
      `workflow ${identity.workflowId} declares its subject name at ${nodeId}.${fieldPath}, and the `
      + `stored checkpoint holds a ${Array.isArray(leaf.value) ? "array" : typeof leaf.value} there; `
      + "a declared subject leaf must resolve to a name, and this projection will not print a "
      + "structured value as one",
    );
  }
  const name = leaf.value.trim();
  if (name.length === 0) {
    throw new Error(
      `workflow ${identity.workflowId} declares its subject name at ${nodeId}.${fieldPath}, and the `
      + "stored checkpoint holds a blank string there; a blank is not a subject, and a row title may "
      + "not be empty",
    );
  }
  return name;
}
