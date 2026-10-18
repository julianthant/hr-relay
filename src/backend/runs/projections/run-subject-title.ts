import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { workflowPlanning } from "../../../workflow-kit/workflow.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { RunEvidenceReceipt } from "../../../models/trust/evidence.js";
import { deriveEvidenceEntryId, evidenceEntryRef } from "../../../models/trust/evidence-identity.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { titleCasePersonName } from "../../../models/fields/cell-coercion.js";
import { ProjectionDegradedError } from "../commands/refusals.js";

import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";

/** The narrow authority read this needs — ref workflow-model's "latest compatible attempt wins". */
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

export function allowsSubjectIdentity(run: RunRecord, descriptor: AnyWorkflowDescriptor): boolean {
  return retainedRunProtectedBindings(run).every(binding => binding.inputPath === "timekeeperName"
    || descriptor.titleProjection?.protectedInput === "eid" && binding.inputPath === "emplId");
}

export function verifiedResultDisplayValue(run: RunRecord, receipt: RunEvidenceReceipt, fieldPath: string, display: "title" | "subtitle"): unknown {
  const envelope = run.envelope;
  if (receipt.runId !== envelope.runId || receipt.traceId !== envelope.traceId || receipt.attempt !== envelope.attempt
    || receipt.workflowId !== envelope.workflow || receipt.descriptorFingerprint !== envelope.contractFingerprint
    || receipt.configFingerprint !== envelope.configFingerprint) throw new ProjectionDegradedError(`result-${display}-receipt-identity-mismatch`);
  const verification = receipt.verification.find(entry => entry.id === deriveEvidenceEntryId(receipt.receiptId, "verification", "completion.terminal-result"));
  const factId = deriveEvidenceEntryId(receipt.receiptId, "output", fieldPath);
  const fact = receipt.output.find(entry => entry.id === factId);
  if (verification?.obligation !== "completion.terminal-result" || verification.verdict !== "verified"
    || !verification.evidence.includes(evidenceEntryRef(factId)) || fact?.state !== "satisfied" || fact.value.state === "redacted"
    || fact.value.state !== "allowed" && (display !== "subtitle" || fact.value.rawValue === undefined)) return undefined;
  return fact.value.rawValue === undefined ? fact.value.value : fact.value.rawValue;
}

export function resolveResultTitle(descriptor: AnyWorkflowDescriptor, run: RunRecord, receipt: RunEvidenceReceipt | undefined): string | undefined {
  const projection = descriptor.titleProjection;
  if (projection === undefined || !allowsSubjectIdentity(run, descriptor)) return undefined;
  const inputTitle = workflowPlanning(descriptor).title(run.input.parsed.value);
  if (receipt === undefined || run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "done") return inputTitle;
  const value = verifiedResultDisplayValue(run, receipt, projection.fieldPath, "title");
  if (value === undefined || value === null) return inputTitle;
  if (typeof value !== "string" || value.trim() === "") throw new ProjectionDegradedError("result-title-value-invalid");
  return titleCasePersonName(value);
}
