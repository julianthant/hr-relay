/**
 * The subject-derived row title (doc 03 §1.2).
 *
 * A run's title starts as whatever `presentation.title` composed from the START
 * INPUT — `Separation 4502`, `EID 10620118`. That is the only honest thing to
 * say before the run has read anything, and it is also the reason three of six
 * rows on a real separations day carried the SAME string: the column an
 * operator scans distinguished nothing, because a document number is not a
 * person.
 *
 * So the title is REPLACED, once, when the run's own reads have settled who the
 * run is about — never blanked while it waits, never guessed. The seam is the
 * descriptor's declared `subjectProjection` (`{nodeId, fieldPath}`): a workflow
 * states where ITS graph resolves a subject's name, the factory proves that
 * path is offered by that node's real output schema, and this module reads the
 * stored checkpoint at that address. There is deliberately NO per-workflow
 * branch and no field-name heuristic anywhere in the path — D204's rule, at the
 * one surface where a wrong answer is a wrong person's name in the place the
 * eye trusts most.
 *
 * ## The four outcomes, and why three of them keep the current title
 *
 *  1. **No declaration.** The workflow never resolves a subject name (its
 *     subject IS the document, or its start input already carried the person).
 *     Its rows keep their composed title forever, and that is a complete
 *     declared state rather than a gap — see `SubjectProjectionSpecRuntimeSchema`.
 *  2. **No checkpoint yet.** The declared node has not run. This is the
 *     ordinary state of every row for the first seconds of its life.
 *  3. **The leaf is absent.** The declared path lives on one arm of a
 *     present/absent union and the run took the other arm — a person-lookup
 *     that resolved nobody, a Kuali document whose employee-name control was
 *     blank. The run genuinely has no subject name; the composed title stands.
 *  4. **The leaf holds something that is not a name.** A non-string, or a blank
 *     string. This one THROWS, naming the workflow, the node, the path and what
 *     was found, because it can only be an authoring defect the build could not
 *     catch — the alternative is a queue row titled `true` or `[object Object]`
 *     or, worse, an empty title parse failure with no clue where it came from.
 *     Substituting the document number here would hide a declaration that has
 *     been wrong since it was written.
 */
import type { JsonValue } from "../../../domain/canonical-json.js";
import type { RunCheckpointRecord } from "../../../domain/workflow/checkpoint.js";

/** The narrow authority read this needs — doc 02 §5.7's "latest compatible attempt wins". */
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

/**
 * Walk a stored output to the declared leaf. A missing key, a `null` on the way
 * through, or a non-record where a record was needed all mean the same thing:
 * the run took an arm this address does not live on.
 */
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

/**
 * The subject's name for this run, or `undefined` when the run has not (or
 * cannot) resolve one — in which case the caller keeps the title it already has.
 */
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
