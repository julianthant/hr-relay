/**
 * Declared evidence classification — doc 11 §6's "redaction is schema-owned"
 * applied to doc 12 §2.3's receipt facts (D136).
 *
 * A receipt is the surface an operator uses to finish a double-check WITHOUT
 * opening the source system, so it carries real values. Which values, and in
 * what form, is a DECLARATION here — never a guess made from a field's name at
 * projection time. Two rules follow from the charter:
 *
 * 1. **A leaf with no declared classification is a loud failure, not a silent
 *    drop.** `redactDiagnosticFields` drops an unclassified *diagnostic* field
 *    with a warning because that channel accepts free-form payloads. A receipt
 *    is different: its leaves come from schemas this repository owns, so an
 *    unclassified leaf is a missing declaration in THIS file — a code gap the
 *    author closes, exactly like `config/pending-impl-bindings.json`. Dropping
 *    it would make a receipt look complete while hiding what the run actually
 *    read or wrote.
 * 2. **The transform is the one the classification allows, and no wider.**
 *    `redactDiagnosticFields` owns the whole transform implementation; this
 *    module only chooses (classification, transform) per leaf and widens the
 *    produced field's `key` from the leaf name to its full dotted path. There
 *    is deliberately no second redaction implementation to drift.
 *
 * ## The leaf rule is the one the provenance collector already uses
 *
 * `src/core/task-provenance.ts` defines an output leaf as: an ARRAY is a leaf,
 * an empty object is a leaf, a populated object recurses, and everything else
 * is a leaf. This module uses exactly that rule so a receipt fact and the
 * `FactProvenance` row that dates it share one path vocabulary. Inventing a
 * second, finer rule here (`results[3].emplId`) would produce facts that no
 * stored provenance row could ever date, and the receipt would have to guess
 * the observation instant — which is the failure mode this whole program
 * exists to prevent.
 *
 * ## Why business values are `safe-diagnostic` and person identifiers are not
 *
 * Doc 11's closed enum has no "operator-visible HR value" arm, so the mapping
 * is stated rather than assumed. A UCPath employee status, a CRM process
 * stage, a Kuali document number, an onboarding date, a page-state id, a proof
 * source: these describe the TRANSACTION, not the person, and the operator
 * already sees them on the queue row and the context rail. They are
 * `safe-diagnostic`.
 *
 * A person's EID or name is a `direct-identifier`, whose widest permitted
 * transform is `last4`. That is deliberately NOT weaker than it looks: the
 * receipt never asks the operator to eyeball two names and decide whether they
 * agree. It carries the SERVER's verdict on the identity obligation with the
 * digest that proves the comparison, which is a stronger double-check than
 * printing the identifier twice would be. `timekeeperName` is classified
 * `direct-identifier` here because `src/domain/secrets.ts` already classifies
 * the `TIMEKEEPER_NAME` environment value that way, and one field cannot carry
 * two classifications. A LIST of people (`results`, `selection.candidateEids`)
 * is `sensitive-hr`/`count`: "one candidate matched" is the fact that decides
 * whether the search was unambiguous, and it is answerable without naming
 * anybody who was not selected.
 */
import { z } from "zod";
import { TaskIdSchema, WorkflowIdSchema } from "../ids.js";
import {
  DataClassificationSchema,
  EvidenceTransformSchema,
  RedactedFieldSchema,
  redactDiagnosticFields,
} from "../redaction.js";

/** Where a leaf came from. A path only means something inside one of these. */
export const EvidenceValueScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflow-input"), workflowId: WorkflowIdSchema }),
  z.strictObject({ kind: z.literal("workflow-result"), workflowId: WorkflowIdSchema }),
  z.strictObject({ kind: z.literal("task-output"), taskId: TaskIdSchema }),
]);
export type EvidenceValueScope = z.infer<typeof EvidenceValueScopeSchema>;

/** `ContractFieldPath`'s grammar, unbranded — the same paths provenance uses. */
export const EvidenceLeafPathSchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/,
  "evidence leaf path must be a dot-delimited camelCase object path",
);

export const EvidenceFieldClassificationSchema = z.strictObject({
  scope: EvidenceValueScopeSchema,
  path: EvidenceLeafPathSchema,
  classification: DataClassificationSchema,
  transform: EvidenceTransformSchema,
});
export type EvidenceFieldClassification = z.infer<typeof EvidenceFieldClassificationSchema>;

export function evidenceScopeKey(scope: EvidenceValueScope): string {
  return scope.kind === "task-output"
    ? `task-output:${scope.taskId}`
    : `${scope.kind}:${scope.workflowId}`;
}

/** `safe-diagnostic` + `allow` — a value about the transaction, not the person. */
function open(scope: EvidenceValueScope, ...paths: readonly string[]): unknown[] {
  return paths.map((path) => ({ scope, path, classification: "safe-diagnostic", transform: "allow" }));
}

/** `direct-identifier` + `last4` — the widest transform doc 11 permits for one. */
function person(scope: EvidenceValueScope, ...paths: readonly string[]): unknown[] {
  return paths.map((path) => ({ scope, path, classification: "direct-identifier", transform: "last4" }));
}

/** `sensitive-hr` + `count` — how many, without naming anyone not selected. */
function population(scope: EvidenceValueScope, ...paths: readonly string[]): unknown[] {
  return paths.map((path) => ({ scope, path, classification: "sensitive-hr", transform: "count" }));
}

const workflowInput = (id: string): EvidenceValueScope =>
  ({ kind: "workflow-input", workflowId: WorkflowIdSchema.parse(id) });
const workflowResult = (id: string): EvidenceValueScope =>
  ({ kind: "workflow-result", workflowId: WorkflowIdSchema.parse(id) });
const taskOutput = (id: string): EvidenceValueScope =>
  ({ kind: "task-output", taskId: TaskIdSchema.parse(id) });

const PERSON_LOOKUP_INPUT = workflowInput("person-lookup");
const PERSON_LOOKUP_RESULT = workflowResult("person-lookup");
const KUALI_INPUT = workflowInput("kuali-timekeeper-annotation");
const KUALI_RESULT = workflowResult("kuali-timekeeper-annotation");
const SEARCH = taskOutput("ucpath/search-person-org");
const CRM_RECORD = taskOutput("crm/read-onboarding-record");
const CRM_DATES = taskOutput("crm/read-onboarding-dates");
const ACTIVE_STATUS = taskOutput("workflow:person-lookup/read-active-status");
const KUALI_FILL = taskOutput("kuali/fill-timekeeper-annotation");
const KUALI_SAVE = taskOutput("kuali/save-timekeeper-annotation");

export const EVIDENCE_FIELD_CLASSIFICATIONS: readonly EvidenceFieldClassification[] = Object.freeze([
  /* person-lookup ingress */
  ...person(PERSON_LOOKUP_INPUT, "name", "emplId"),
  ...open(PERSON_LOOKUP_INPUT, "keepNonHdh", "includeCrmDates"),

  /* ucpath/search-person-org — every arm of the selection union, not only the
     one the contract example happens to show. `selection.selected` is declared
     twice over: as a leaf (the `null` of the ambiguous/not-found arms) and as
     the object whose fields the resolved arm carries. */
  ...population(SEARCH, "results", "selection.candidateEids"),
  ...person(SEARCH, "selection.selected.emplId", "selection.selected.name", "selection.searchName"),
  ...open(SEARCH, "selection.status", "selection.selected", "selection.selected.department",
    "selection.selected.jobTitle", "selection.selected.employeeStatus", "selection.selected.hdh"),

  /* crm/read-onboarding-record */
  ...person(CRM_RECORD, "record.emplId", "record.fullName", "queriedEid"),
  ...open(CRM_RECORD, "state", "record.recordId", "record.rawStage", "reason"),

  /* crm/read-onboarding-dates */
  ...person(CRM_DATES, "emplId"),
  ...open(CRM_DATES, "invitedOn.state", "invitedOn.value", "invitedOn.reason",
    "startsOn.state", "startsOn.value", "startsOn.reason",
    "completedOn.state", "completedOn.value", "completedOn.reason"),

  /* workflow:person-lookup/read-active-status */
  ...open(ACTIVE_STATUS, "state", "reason", "hdh"),

  /* person-lookup terminal result */
  ...open(PERSON_LOOKUP_RESULT, "activeStatus.state", "activeStatus.reason", "activeStatus.hdh",
    "crmDates.state", "crmDates.dates.invitedOn.state", "crmDates.dates.invitedOn.value",
    "crmDates.dates.invitedOn.reason", "crmDates.dates.startsOn.state",
    "crmDates.dates.startsOn.value", "crmDates.dates.startsOn.reason",
    "crmDates.dates.completedOn.state", "crmDates.dates.completedOn.value",
    "crmDates.dates.completedOn.reason"),
  ...person(PERSON_LOOKUP_RESULT, "crmDates.dates.emplId"),

  /* kuali-timekeeper-annotation ingress */
  ...open(KUALI_INPUT, "actionId", "documentNumber"),
  ...person(KUALI_INPUT, "emplId", "timekeeperName"),

  /* kuali/fill-timekeeper-annotation (prepare) */
  ...open(KUALI_FILL, "stagedPageState", "actionId", "documentNumber", "observedAt"),
  ...person(KUALI_FILL, "observedEid", "previousTimekeeperName", "stagedTimekeeperName"),

  /* kuali/save-timekeeper-annotation (commit) */
  ...open(KUALI_SAVE, "savedState.kind", "savedState.actionId", "savedState.documentNumber",
    "savedState.source"),
  ...person(KUALI_SAVE, "savedState.timekeeperName", "savedState.observedEid"),

  /* kuali terminal result */
  ...open(KUALI_RESULT, "disposition", "saved.kind", "saved.actionId", "saved.documentNumber",
    "saved.source"),
  ...person(KUALI_RESULT, "saved.timekeeperName", "saved.observedEid"),
].map((entry) => Object.freeze(EvidenceFieldClassificationSchema.parse(entry))));

const BY_SCOPE_AND_PATH = new Map<string, EvidenceFieldClassification>();
for (const entry of EVIDENCE_FIELD_CLASSIFICATIONS) {
  const key = `${evidenceScopeKey(entry.scope)} ${entry.path}`;
  const existing = BY_SCOPE_AND_PATH.get(key);
  if (existing !== undefined) {
    throw new Error(
      `evidence classification for ${evidenceScopeKey(entry.scope)} field "${entry.path}" is declared `
      + `twice (${existing.classification}/${existing.transform} and ${entry.classification}/${entry.transform})`,
    );
  }
  BY_SCOPE_AND_PATH.set(key, entry);
}

export interface EvidenceLeaf {
  /** The dotted path, in the same vocabulary `FactProvenance.path` uses. */
  readonly path: string;
  /** The leaf's own camelCase name, which is what `EvidenceFact.field` accepts. */
  readonly field: string;
  readonly value: unknown;
}

/**
 * Every leaf of a JSON value, by the provenance collector's rule: an array is
 * a leaf, an empty object is a leaf, a populated object recurses.
 *
 * Keys are visited in SORTED order, which is what makes a receipt a pure
 * function of authority rather than of how a value happened to be built. A
 * stored record round-trips through `canonicalJsonStringify` (sorted keys)
 * while an in-memory value keeps its authored key order; walking insertion
 * order would emit the same facts in two different orders — and therefore two
 * byte-different receipts — for one run.
 */
export function evidenceLeaves(value: unknown, prefix = ""): readonly EvidenceLeaf[] {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    return [leafOf(prefix, value)];
  }
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (entries.length === 0) return [leafOf(prefix, value)];
  return entries.flatMap(([key, child]) => evidenceLeaves(
    child,
    prefix.length === 0 ? key : `${prefix}.${key}`,
  ));
}

function leafOf(path: string, value: unknown): EvidenceLeaf {
  if (path.length === 0) {
    throw new Error("an evidence leaf must be named; a bare scalar or array has no field identity");
  }
  const field = path.split(".").at(-1);
  if (field === undefined || !/^[a-z][A-Za-z0-9]*$/.test(field)) {
    throw new Error(`evidence leaf "${path}" has no camelCase field name`);
  }
  return Object.freeze({ path, field, value });
}

/** The declared classification, or a loud refusal naming the exact gap. */
export function classifyEvidenceLeaf(
  scope: EvidenceValueScope,
  path: string,
): EvidenceFieldClassification {
  const entry = BY_SCOPE_AND_PATH.get(`${evidenceScopeKey(scope)} ${path}`);
  if (entry === undefined) {
    throw new Error(
      `no declared evidence classification for ${evidenceScopeKey(scope)} field "${path}"; `
      + "add it to src/domain/trust/evidence-classification.ts — a receipt never drops a leaf silently",
    );
  }
  return entry;
}

/**
 * Redact one leaf through the ONE shared transform implementation. The produced
 * field's `key` is widened from the leaf name to its full path, which
 * `RedactedFieldSchema` accepts and `ClassifiedDiagnosticValueSchema` does not
 * — the classified INPUT is per-field, the redacted OUTPUT names where it sat.
 */
export function redactEvidenceLeaf(
  scope: EvidenceValueScope,
  leaf: EvidenceLeaf,
): z.infer<typeof RedactedFieldSchema> {
  const declared = classifyEvidenceLeaf(scope, leaf.path);
  const redaction = redactDiagnosticFields([{
    key: leaf.field,
    classification: declared.classification,
    transform: declared.transform,
    value: leaf.value,
  }]);
  const [field] = redaction.fields;
  if (field === undefined || redaction.warnings.length > 0) {
    throw new Error(
      `evidence leaf "${leaf.path}" of ${evidenceScopeKey(scope)} could not be redacted `
      + `as ${declared.classification}/${declared.transform}: ${redaction.warnings.join("; ")}`,
    );
  }
  return RedactedFieldSchema.parse({ ...field, key: leaf.path });
}
