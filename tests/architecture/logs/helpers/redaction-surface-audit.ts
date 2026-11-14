import { AssistantConversationViewSchema, AssistantHistoryOperationSchema, AssistantHistoryViewSchema, AssistantRequestSchema, AssistantRespondEnvelopeSchema } from "../../../../src/models/dashboard/assistant.js";
import { ASSISTANT_PLUGIN_MODULES, assistantToolEgress } from "./assistant-tool-egress.js";
import { ActivityPopulationSelectionSchema, ActivityPopulationSelectedReadSchema, ActivityPopulationExportSchema } from "../../../../src/models/dashboard/activity-population.js";
import { ChatGptAccountStatusSchema, ChatGptSignInStartResultSchema, ChatGptSignInCompletionSchema, ChatGptCancelResultSchema, ChatGptOcrTestResultSchema } from "../../../../src/models/dashboard/chatgpt-account.js";
import { EditableWorkbookSchema, SavedWorkbookSchema, EditableWorkbookWireSchema, SavedWorkbookWireSchema,
  WorkbookListWireSchema, WorkbookHistoryWireSchema, WorkbookCreateRequestSchema, WorkbookSaveRequestSchema,
  WorkbookIntakeRequestSchema, WorkbookIntakeResultSchema, IntakeCommandResultWireSchema,
  WorkbookTypeSchema, WorkbookMetadataSchema, WorkbookOperationSchema, WorkbookOperatorOperationRequestSchema,
  WorkbookOperationReceiptSchema, WorkbookNamedVersionSchema, WorkbookSnapshotRequestSchema, WorkbookSnapshotSchema } from "../../../../src/models/dashboard/workbooks.js";
import { CalendarWireSchema } from "../../../../src/models/dashboard/calendar.js";
import { WorkbookCompatibilitySchema, WorkbookLibraryCatalogSchema, WorkbookLibraryVersionViewSchema, WorkbookLibraryActionSchema, WorkbookLibraryActionResultSchema, WorkbookLibraryActionStatusSchema,
  WorkbookLibraryStateSchema, WorkbookLibrarySnapshotSchema, WorkbookLibraryActionRecordSchema } from "../../../../src/models/dashboard/workbook-library.js";
import { PlannedRunOutputSchema } from "../../../../src/models/dashboard/run-outputs.js";
import { ProfileFirstRunCheckSchema } from "../../../../src/models/profiles/public-profile.js";

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import { CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { ProtectedSettingsNameSchema, ProtectedSettingsPresenceSchema, ProtectedSettingsReadbackSchema } from "../../../../src/models/config/protected-settings.js";
import { SettingsApplyRefusalSchema, SettingsApplyRejectionCodeSchema, SettingsRuntimeStatusSchema } from "../../../../src/models/config/settings.js";
import { ActionDescriptorWireSchema } from "../../../../src/models/dashboard/actions.js";
import { ActivityReportSelectionSchema } from "../../../../src/models/dashboard/activity-selection.js";
import { RunSearchIndexRecordSchema, RunSearchDeclarationSchema, RunSearchGramSchema, RunSearchActorLinkSchema } from "../../../../src/models/dashboard/search-index.js";
import { ArtifactResourceWireSchema, CapturePointerWireSchema } from "../../../../src/models/dashboard/artifacts.js";
import { FrontendBootstrapWireSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { WorkbookReferenceWriteSchema } from "../../../../src/models/processing/workbooks/read-result.js";
import { NativePathPickerResponseSchema } from "../../../../src/models/dashboard/native-path-picker.js";
import { DiagnosticBundleWireSchema } from "../../../../src/models/dashboard/diagnostic-bundle.js";
import { WorkflowExplorerWireSchema } from "../../../../src/models/dashboard/explorer.js";
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from "../../../../src/models/dashboard/projection.js";
import { OcrCommandResultWireSchema, RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { WorkerCommandResultWireSchema } from "../../../../src/models/dashboard/worker-command-result.js";
import { CrossDateSearchPageSchema } from "../../../../src/models/dashboard/search.js";
import { SettingsFactsWireSchema } from "../../../../src/models/dashboard/settings.js";
import { EditableSettingsPathSchema, EditableSettingsWireSchema } from "../../../../src/models/dashboard/settings-editor.js";
import { StorageDoctorWireSchema, StorageDoctorLatestWireSchema, ProtectedSettingsInspectionWireSchema } from "../../../../src/models/dashboard/storage.js";
import { ClearRunHistoryRequestSchema, RunHistoryStatusSchema, ClearRunHistoryResultSchema } from "../../../../src/models/dashboard/run-history.js";
import { DashboardStreamEnvelopeSchema } from "../../../../src/models/dashboard/subscription.js";
import { OperatorXlsxExportEvidenceSchema } from "../../../../src/models/dashboard/xlsx-export.js";
import { RerunValuesResponseSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningWireSchema } from "../../../../src/models/dashboard/rerun-warning.js";
import { StartPlanWireSchema } from "../../../../src/models/dashboard/start-plan.js";
import { IntakeSessionWireSchema } from "../../../../src/models/intake/wire.js";
import { LedgerEntrySchema } from "../../../../src/rules/runs/ledger.js";
import { NotificationProjectionSchema, NotificationTriggerEventSchema } from "../../../../src/rules/notifications/notification-triggers.js";
import { NotificationRecordSchema } from "../../../../src/models/notifications/notifications.js";
import { DiagnosticBundleSchema } from "../../../../src/models/trust/diagnostic.js";
import { RunEvidenceReceiptSchema } from "../../../../src/models/trust/evidence.js";
import { FailureRecordSchema } from "../../../../src/models/trust/failure.js";
import { REPO_ROOT, repoRelative, walkFiles } from "../../support/helpers/guard-files.js";

/* ── 1. the vocabulary ────────────────────────────────────────────────────── */

export const SurfaceEgressSchema = z.enum([
  /** Served over the loopback dashboard to the one authorized operator. */
  "operator-loopback",
  /** A row in the authority database, re-served and retained. */
  "durable-authority",
  /** Bytes written to a file under the state root and never pruned. */
  "durable-file",
  /** Bytes handed to a third party — today, an AI provider. */
  "process-egress",
  /** Text the operating system renders, possibly on a locked screen. */
  "os-notification",
]);
export type SurfaceEgress = z.infer<typeof SurfaceEgressSchema>;

export const LeafOriginSchema = z.enum([
  "repository-authored",
  "operator-authored",
  "declared-redacted",
  "local-filesystem-name",
  "captured-hr-value",
  "protected-value",
  "external-text",
]);
export type LeafOrigin = z.infer<typeof LeafOriginSchema>;


const ORIGIN_RULE_BY_EGRESS: Readonly<
  Record<SurfaceEgress, Readonly<Record<LeafOrigin, "permitted" | "exception" | "refused">>>
> = Object.freeze({
  "operator-loopback": {
    "repository-authored": "permitted",
    "operator-authored": "permitted",
    "declared-redacted": "permitted",
    "local-filesystem-name": "permitted",
    "captured-hr-value": "permitted",
    "protected-value": "permitted",
    "external-text": "permitted",
  },
  "durable-authority": {
    "repository-authored": "permitted",
    "operator-authored": "exception",
    "declared-redacted": "permitted",
    "local-filesystem-name": "permitted",
    "captured-hr-value": "permitted",
    "protected-value": "exception",
    "external-text": "exception",
  },
  "durable-file": {
    "repository-authored": "permitted",
    "operator-authored": "permitted",
    "declared-redacted": "permitted",
    "local-filesystem-name": "permitted",
    "captured-hr-value": "exception",
    "protected-value": "exception",
    "external-text": "refused",
  },
  "process-egress": {
    "repository-authored": "permitted",
    "operator-authored": "refused",
    "declared-redacted": "permitted",
    "local-filesystem-name": "refused",
    "captured-hr-value": "refused",
    "protected-value": "refused",
    "external-text": "refused",
  },
  "os-notification": {
    "repository-authored": "permitted",
    "operator-authored": "refused",
    "declared-redacted": "refused",
    "local-filesystem-name": "refused",
    "captured-hr-value": "refused",
    "protected-value": "refused",
    "external-text": "refused",
  },
});

/** The only leaves admitted past a refused egress rule, each by a named operator decision; they still need a written exception. */
export const EGRESS_DECISION_LEAVES: ReadonlyMap<string, Readonly<{ egress: SurfaceEgress; origin: LeafOrigin }>> = new Map([
  // D1 (11-06): the masked operator-authored assistant user message goes to ChatGPT.
  ["egress/assistant-user-message|content", { egress: "process-egress", origin: "operator-authored" }],
  // D3 (11-06): a stored answer's model text, with its references, is replayed to ChatGPT in later turns of the same chat.
  ["egress/assistant-replay|answer", { egress: "process-egress", origin: "external-text" }],
]);
export function originRule(
  egress: SurfaceEgress,
  origin: LeafOrigin,
): "permitted" | "exception" | "refused" {
  return ORIGIN_RULE_BY_EGRESS[egress][origin];
}

/* ── 2. the leaf walk ─────────────────────────────────────────────────────── */

export const SurfaceLeafKindSchema = z.enum([
  /** An enum, a literal, a number, a boolean, or a pattern/format-constrained string. */
  "closed",
  /** A `RedactedField`/`RedactedValue` subtree — it carries its own declaration. */
  "declared-redacted",
  /** An unconstrained string. */
  "free-text",
  /** Open JSON, an empty object, or an open record. */
  "open-json",
]);
export type SurfaceLeafKind = z.infer<typeof SurfaceLeafKindSchema>;

export interface SurfaceLeaf {
  readonly path: string;
  readonly kind: SurfaceLeafKind;
}

type JsonSchemaNode = Readonly<Record<string, unknown>>;

function asNode(value: unknown): JsonSchemaNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonSchemaNode)
    : undefined;
}

// Recognize redaction structurally so extended arms cannot escape through a different serialized schema.
function isRedactionArmUnion(node: JsonSchemaNode): boolean {
  const arms = node.anyOf ?? node.oneOf;
  if (!Array.isArray(arms) || arms.length === 0) return false;
  return arms.every((arm) => {
    const properties = asNode(asNode(arm)?.properties);
    if (properties === undefined) return false;
    const keys = new Set(Object.keys(properties));
    return keys.has("state") && keys.has("classification") && keys.has("transform");
  });
}

function collectLeaves(node: unknown, path: string, out: SurfaceLeaf[]): void {
  const schema = asNode(node);
  if (schema === undefined) {
    // `true`, `{}` after normalisation, or a bare boolean schema: anything goes.
    out.push({ path, kind: "open-json" });
    return;
  }
  if (isRedactionArmUnion(schema)) {
    out.push({ path, kind: "declared-redacted" });
    return;
  }
  if (Array.isArray(schema.enum) || Object.hasOwn(schema, "const")) {
    out.push({ path, kind: "closed" });
    return;
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const arms = schema[key];
    if (Array.isArray(arms)) {
      for (const arm of arms) collectLeaves(arm, path, out);
      return;
    }
  }
  // A `$ref` under `cycles: "ref"` is the recursive `JsonValue` — open by
  // construction, and following it would not terminate.
  if (schema.$ref !== undefined) {
    out.push({ path, kind: "open-json" });
    return;
  }
  if (Array.isArray(schema.type) && schema.type.length > 0) {
    const types: readonly unknown[] = schema.type;
    for (const type of types) collectLeaves({ ...schema, type }, path, out);
    return;
  }
  if (schema.type === "object" || schema.properties !== undefined) {
    const properties = asNode(schema.properties) ?? {};
    const keys = Object.keys(properties).sort();
    if (keys.length === 0) {
      out.push({ path, kind: "open-json" });
      return;
    }
    for (const key of keys) {
      collectLeaves(properties[key], path === "" ? key : `${path}.${key}`, out);
    }
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
      out.push({ path: `${path}.*`, kind: "open-json" });
    }
    return;
  }
  if (schema.type === "array") {
    collectLeaves(schema.items, `${path}[]`, out);
    return;
  }
  if (schema.type === "string") {
    const constrained = typeof schema.pattern === "string" || typeof schema.format === "string";
    out.push({ path, kind: constrained ? "closed" : "free-text" });
    return;
  }
  if (
    schema.type === "number" || schema.type === "integer"
    || schema.type === "boolean" || schema.type === "null"
  ) {
    out.push({ path, kind: "closed" });
    return;
  }
  // An unrecognised node is treated as open rather than skipped: a leaf this
  // walk cannot classify is exactly the leaf a reviewer must look at.
  out.push({ path, kind: "open-json" });
}

const LEAF_KIND_SEVERITY: Readonly<Record<SurfaceLeafKind, number>> = Object.freeze({
  closed: 0,
  "declared-redacted": 0,
  "free-text": 1,
  "open-json": 2,
});


export function surfaceLeaves(schema: z.ZodType): readonly SurfaceLeaf[] {
  const json = z.toJSONSchema(schema, { io: "output", unrepresentable: "any", cycles: "ref" });
  const collected: SurfaceLeaf[] = [];
  collectLeaves(json, "", collected);
  const strongest = new Map<string, SurfaceLeaf>();
  for (const leaf of collected) {
    const previous = strongest.get(leaf.path);
    if (previous === undefined || LEAF_KIND_SEVERITY[leaf.kind] > LEAF_KIND_SEVERITY[previous.kind]) {
      strongest.set(leaf.path, leaf);
    }
  }
  return Object.freeze([...strongest.values()].sort((left, right) => left.path.localeCompare(right.path)));
}

/** The leaves that need a declared origin — the rest carry their own proof. */
export function decidableLeaves(schema: z.ZodType): readonly SurfaceLeaf[] {
  return surfaceLeaves(schema).filter(({ kind }) => kind === "free-text" || kind === "open-json");
}

/* ── 3. the audit ─────────────────────────────────────────────────────────── */

export const SurfaceLeafOriginSchema = z.strictObject({
  surface: z.string().min(1),
  path: z.string().min(1),
  origin: LeafOriginSchema,
  /** Required exactly when the egress matrix says the origin needs one. */
  exception: z.string().min(40).optional(),
});
export type SurfaceLeafOrigin = z.infer<typeof SurfaceLeafOriginSchema>;

export interface RedactionSurface {
  readonly id: string;
  readonly egress: SurfaceEgress;
  /** The repo-relative module that owns the schema. */
  readonly module: string;
  readonly schema: z.ZodType;
}


export const RedactedNameWaiverSchema = z.strictObject({
  field: z.string().regex(/Redacted$/),
  reason: z.string().min(60),
});
export type RedactedNameWaiver = z.infer<typeof RedactedNameWaiverSchema>;

export const REDACTED_NAME_WAIVERS: readonly RedactedNameWaiver[] = Object.freeze(
  RedactedNameWaiverSchema.array().parse([
    {
      field: "valueRedacted",
      reason:
        "D183 finding: `ContextSectionSchema`/`ContextDataSectionSchema` name their scalar "
        + "`valueRedacted`, and src/backend/runs/queries/run-detail.ts serves the RAW recorded "
        + "value — the descriptor-declared detail patch, the stored checkpoint scalar, or a count. "
        + "That is ref dashboard-surfaces's Data rail working as designed: the operator's own loopback "
        + "surface is entitled to the values their run touched, and a digest there would answer "
        + "nothing. The NAME is the defect, not the value, and renaming a served wire field is a "
        + "ref dashboard-surfaces contract change with its own decision — recorded here so the next reader does "
        + "not mistake the suffix for a guarantee.",
    },
  ]),
);

const WAIVED_REDACTED_FIELDS: ReadonlySet<string> = new Set(
  REDACTED_NAME_WAIVERS.map(({ field }) => field),
);

function leafFieldName(path: string): string {
  return (path.split(".").at(-1) ?? "").replace(/\[\]$/, "");
}

export function auditSurfaceOrigins(
  surfaces: readonly RedactionSurface[],
  dispositions: readonly SurfaceLeafOrigin[],
): readonly string[] {
  const violations: string[] = [];
  const declared = new Map<string, SurfaceLeafOrigin>();
  for (const entry of dispositions) {
    const key = `${entry.surface}|${entry.path}`;
    if (declared.has(key)) {
      violations.push(`${key}: declared twice`);
      continue;
    }
    declared.set(key, entry);
  }

  const surfaceIds = new Set(surfaces.map(({ id }) => id));
  for (const entry of dispositions) {
    if (!surfaceIds.has(entry.surface)) {
      violations.push(`${entry.surface}|${entry.path}: names no registered surface`);
    }
  }

  const reached = new Set<string>();
  for (const surface of surfaces) {
    for (const leaf of decidableLeaves(surface.schema)) {
      const key = `${surface.id}|${leaf.path}`;
      reached.add(key);
      const entry = declared.get(key);
      if (entry === undefined) {
        violations.push(
          `${surface.id} (${surface.egress}) leaf "${leaf.path}" is ${leaf.kind} and carries no declared `
          + "origin; add it to SURFACE_LEAF_ORIGINS in "
          + "tests/architecture/logs/helpers/redaction-surface-audit.ts — a wire field is not "
          + "reviewed until somebody says where its bytes come from",
        );
        continue;
      }
      const decision = EGRESS_DECISION_LEAVES.get(key);
      const rule = decision !== undefined && decision.egress === surface.egress && decision.origin === entry.origin ? "exception" : originRule(surface.egress, entry.origin);
      if (rule === "refused") {
        violations.push(
          `${surface.id} (${surface.egress}) leaf "${leaf.path}" is declared ${entry.origin}, which a `
          + `${surface.egress} surface may not carry at all; redact it at the producer or move the field`,
        );
        continue;
      }
      if (rule === "exception" && entry.exception === undefined) {
        violations.push(
          `${surface.id} (${surface.egress}) leaf "${leaf.path}" is declared ${entry.origin}, which needs `
          + "a written exception naming the decision that admits it",
        );
        continue;
      }
      const field = leafFieldName(leaf.path);
      if (
        field.endsWith("Redacted")
        && entry.origin !== "declared-redacted"
        && !WAIVED_REDACTED_FIELDS.has(field)
      ) {
        violations.push(
          `${surface.id} leaf "${leaf.path}" is named as if it were redacted but is declared `
          + `${entry.origin}; redact it at the producer or waive the NAME in REDACTED_NAME_WAIVERS `
          + "with a reason — a suffix that promises what the producer does not do is worse than no "
          + "suffix at all",
        );
        continue;
      }
      if (rule === "permitted" && entry.exception !== undefined) {
        violations.push(
          `${surface.id} (${surface.egress}) leaf "${leaf.path}" carries an exception it does not need `
          + `(${entry.origin} is permitted here); an unnecessary exception hides the ones that matter`,
        );
      }
    }
  }

  for (const key of declared.keys()) {
    if (!reached.has(key) && surfaceIds.has(key.split("|")[0] ?? "")) {
      violations.push(`${key}: declared origin for a leaf the surface no longer carries`);
    }
  }
  return violations;
}




export const D331ServedValueClassSchema = z.enum(["closed-literal", "identifier-free"]);
export type D331ServedValueClass = z.infer<typeof D331ServedValueClassSchema>;

export const D331ServedSurfaceSchema = z.enum([
  "protected-settings-doctor",
  "protected-settings-readback",
  "frontend-bootstrap",
  "settings-command-result",
  "settings-runtime-status",
  "host-display",
  "settings-apply-refusal",
]);
export type D331ServedSurface = z.infer<typeof D331ServedSurfaceSchema>;

export const D331ServedLeafDispositionSchema = z.strictObject({
  surface: D331ServedSurfaceSchema,
  path: z.string().min(1),
  valueClass: D331ServedValueClassSchema,
});
export type D331ServedLeafDisposition = z.infer<typeof D331ServedLeafDispositionSchema>;

interface ExpectedD331ServedLeaf extends D331ServedLeafDisposition {
  readonly evidence: string;
}

function d331DispositionKey(entry: Pick<D331ServedLeafDisposition, "surface" | "path">): string {
  return `${entry.surface}|${entry.path}`;
}

function expectedD331ServedLeaves(): readonly ExpectedD331ServedLeaf[] {
  const expected: ExpectedD331ServedLeaf[] = [];
  const add = (
    surface: D331ServedSurface,
    path: string,
    valueClass: D331ServedValueClass,
    evidence: string,
  ): void => {
    expected.push({ surface, path, valueClass, evidence });
  };

  for (const leaf of surfaceLeaves(ProtectedSettingsInspectionWireSchema))
    add("protected-settings-doctor", leaf.path, leaf.path === "cause.summary" ? "identifier-free" : "closed-literal",
      "ProtectedSettingsInspectionWireSchema names and presence only");

  for (const name of ProtectedSettingsNameSchema.options) {
    for (const leaf of surfaceLeaves(ProtectedSettingsPresenceSchema)) {
      add(
        "protected-settings-readback",
        `entries.${name}.${leaf.path}`,
        leaf.path === "present" ? "closed-literal" : "identifier-free",
        "ProtectedSettingsNameSchema × ProtectedSettingsPresenceSchema",
      );
    }
  }
  add(
    "protected-settings-readback",
    "revision",
    "identifier-free",
    "ProtectedSettingsReadbackSchema.revision",
  );
  add(
    "frontend-bootstrap",
    "protectedSchemaHash",
    "identifier-free",
    "FrontendBootstrapWireSchema.protectedSchemaHash",
  );
  add(
    "settings-command-result",
    "restartRequired",
    "closed-literal",
    "CommandResultSchema.restartRequired",
  );
  add(
    "settings-command-result",
    "revision",
    "identifier-free",
    "CommandResultSchema protected-settings revision",
  );
  for (const leaf of surfaceLeaves(SettingsRuntimeStatusSchema)) {
    add(
      "settings-runtime-status",
      leaf.path,
      leaf.path === "state" ? "closed-literal" : "identifier-free",
      "SettingsRuntimeStatusSchema",
    );
  }
  for (const path of EditableSettingsPathSchema.options.filter((candidate) => candidate.startsWith("display."))) {
    add(
      "host-display",
      `${path}.defaultValue`,
      "identifier-free",
      "EditableSettingsWireSchema defaultValue is the probed host display fact",
    );
    add(
      "host-display",
      `${path}.effectiveValue`,
      "identifier-free",
      "EditableSettingsWireSchema effectiveValue is the active resolved display fact",
    );
  }
  add(
    "settings-apply-refusal",
    "state.conflict",
    "closed-literal",
    "SettingsApplyRefusalSchema conflict discriminator",
  );
  add(
    "settings-apply-refusal",
    "currentRevision",
    "identifier-free",
    "SettingsApplyRefusalSchema.currentRevision",
  );
  for (const code of SettingsApplyRejectionCodeSchema.options) {
    add(
      "settings-apply-refusal",
      `code.${code}`,
      "closed-literal",
      "SettingsApplyRejectionCodeSchema",
    );
  }
  return Object.freeze(expected);
}

function schemaLeafPaths(schema: z.ZodType): ReadonlySet<string> {
  return new Set(surfaceLeaves(schema).map(({ path }) => path));
}


export const D331_SERVED_LEAF_DISPOSITIONS: readonly D331ServedLeafDisposition[] = Object.freeze(
  D331ServedLeafDispositionSchema.array().parse([
    { surface: "protected-settings-doctor", path: "state", valueClass: "closed-literal" },
    { surface: "protected-settings-doctor", path: "entries[].name", valueClass: "closed-literal" },
    { surface: "protected-settings-doctor", path: "entries[].present", valueClass: "closed-literal" },
    { surface: "protected-settings-doctor", path: "cause.code", valueClass: "closed-literal" },
    { surface: "protected-settings-doctor", path: "cause.summary", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "entries.ucpathUserId.present", valueClass: "closed-literal" },
    { surface: "protected-settings-readback", path: "entries.ucpathUserId.updatedAt", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "entries.ucpathUserId.valueId", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "entries.ucpathPassword.present", valueClass: "closed-literal" },
    { surface: "protected-settings-readback", path: "entries.ucpathPassword.updatedAt", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "entries.ucpathPassword.valueId", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "entries.sharepointOnboardingRosterUrl.present", valueClass: "closed-literal" },
    { surface: "protected-settings-readback", path: "entries.sharepointOnboardingRosterUrl.updatedAt", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "entries.sharepointOnboardingRosterUrl.valueId", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "revision", valueClass: "identifier-free" },
    { surface: "frontend-bootstrap", path: "protectedSchemaHash", valueClass: "identifier-free" },
    { surface: "settings-command-result", path: "restartRequired", valueClass: "closed-literal" },
    { surface: "settings-command-result", path: "revision", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "active.configFingerprint", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "active.settingsFingerprint", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "active.settingsRevision", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "active.settingsSchemaHash", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "identity.configFingerprint", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "identity.settingsFingerprint", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "identity.settingsRevision", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "identity.settingsSchemaHash", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "persisted.configFingerprint", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "persisted.settingsFingerprint", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "persisted.settingsRevision", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "persisted.settingsSchemaHash", valueClass: "identifier-free" },
    { surface: "settings-runtime-status", path: "state", valueClass: "closed-literal" },
    { surface: "host-display", path: "display.screenWidth.defaultValue", valueClass: "identifier-free" },
    { surface: "host-display", path: "display.screenWidth.effectiveValue", valueClass: "identifier-free" },
    { surface: "host-display", path: "display.screenHeight.defaultValue", valueClass: "identifier-free" },
    { surface: "host-display", path: "display.screenHeight.effectiveValue", valueClass: "identifier-free" },
    { surface: "settings-apply-refusal", path: "state.conflict", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "currentRevision", valueClass: "identifier-free" },
    { surface: "settings-apply-refusal", path: "code.schema-mismatch", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.patch-fingerprint-mismatch", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.envelope-fingerprint-mismatch", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.not-editable", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.invalid-value", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.cross-field-invalid", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.document-too-large", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.authority-unjournaled", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.authority-uncertain", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.directory-integrity", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.lock-unavailable", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.command-divergent", valueClass: "closed-literal" },
    { surface: "settings-apply-refusal", path: "code.write-id-reused", valueClass: "closed-literal" },
  ]),
);

export function auditD331ServedLeafDispositions(
  input: readonly unknown[],
): readonly string[] {
  const violations: string[] = [];
  const readbackLeaves = schemaLeafPaths(ProtectedSettingsReadbackSchema);
  const bootstrapLeaves = schemaLeafPaths(FrontendBootstrapWireSchema);
  const commandLeaves = schemaLeafPaths(CommandResultSchema);
  const refusalLeaves = schemaLeafPaths(SettingsApplyRefusalSchema);
  const editorLeaves = schemaLeafPaths(EditableSettingsWireSchema);
  const requiredAnchors: readonly [string, ReadonlySet<string>, string][] = [
    ["ProtectedSettingsReadbackSchema", readbackLeaves, "entries"],
    ["ProtectedSettingsReadbackSchema", readbackLeaves, "revision"],
    ["FrontendBootstrapWireSchema", bootstrapLeaves, "protectedSchemaHash"],
    ["CommandResultSchema", commandLeaves, "restartRequired"],
    ["CommandResultSchema", commandLeaves, "revision"],
    ["SettingsApplyRefusalSchema", refusalLeaves, "state"],
    ["SettingsApplyRefusalSchema", refusalLeaves, "currentRevision"],
    ["SettingsApplyRefusalSchema", refusalLeaves, "code"],
    ["EditableSettingsWireSchema", editorLeaves, "sections[].leaves[].defaultValue"],
    ["EditableSettingsWireSchema", editorLeaves, "sections[].leaves[].effectiveValue"],
  ];
  for (const [schema, leaves, path] of requiredAnchors) {
    if (!leaves.has(path)) violations.push(`${schema} no longer carries required redaction leaf "${path}"`);
  }

  const parsed: D331ServedLeafDisposition[] = [];
  for (const [index, value] of input.entries()) {
    const result = D331ServedLeafDispositionSchema.safeParse(value);
    if (!result.success) {
      violations.push(`settings disposition row ${String(index)} is invalid: ${result.error.issues[0]?.message ?? "invalid row"}`);
      continue;
    }
    parsed.push(result.data);
  }
  const declared = new Map<string, D331ServedLeafDisposition>();
  for (const entry of parsed) {
    const key = d331DispositionKey(entry);
    if (declared.has(key)) {
      violations.push(`${key}: declared twice`);
    } else {
      declared.set(key, entry);
    }
  }
  const expected = expectedD331ServedLeaves();
  const expectedKeys = new Set(expected.map(d331DispositionKey));
  for (const entry of expected) {
    const key = d331DispositionKey(entry);
    const disposition = declared.get(key);
    if (disposition === undefined) {
      violations.push(`${key}: carries no served-settings disposition (${entry.evidence})`);
    } else if (disposition.valueClass !== entry.valueClass) {
      violations.push(
        `${key}: ${disposition.valueClass} contradicts ${entry.valueClass} (${entry.evidence})`,
      );
    }
  }
  for (const entry of declared.values()) {
    const key = d331DispositionKey(entry);
    if (!expectedKeys.has(key)) violations.push(`${key}: disposition names no current served settings leaf`);
  }
  return Object.freeze(violations);
}

/* ── 4. the module ratchet ────────────────────────────────────────────────── */


export const SurfaceModuleDispositionSchema = z.strictObject({
  module: z.string().min(1),
  state: z.enum(["audited", "no-surface"]),
  reason: z.string().min(20),
});
export type SurfaceModuleDisposition = z.infer<typeof SurfaceModuleDispositionSchema>;

export const SURFACE_MODULE_ROOTS: readonly string[] = Object.freeze([
  "src/models/dashboard",
]);

/** Surface-bearing modules outside the scanned roots, named one by one. */
export const EXTRA_SURFACE_MODULES: readonly string[] = Object.freeze([
  "src/backend/assistant/service.ts",
  ...ASSISTANT_PLUGIN_MODULES,
  "src/models/intake/wire.ts",
  "src/models/processing/workbooks/read-result.ts",
  "src/rules/runs/ledger.ts",
  "src/rules/notifications/notification-triggers.ts",
  "src/models/notifications/notifications.ts",
  "src/models/trust/diagnostic.ts",
  "src/models/trust/evidence.ts",
  "src/models/trust/failure.ts",
  "src/models/profiles/public-profile.ts",
]);

export function scannedSurfaceModules(): readonly string[] {
  const files: string[] = [];
  for (const root of SURFACE_MODULE_ROOTS) {
    const absolute = join(REPO_ROOT, root);
    for (const name of readdirSync(absolute)) {
      const path = join(absolute, name);
      if (!statSync(path).isFile() || !name.endsWith(".ts")) continue;
      files.push(relative(REPO_ROOT, path).replaceAll("\\", "/"));
    }
  }
  return Object.freeze([...files, ...EXTRA_SURFACE_MODULES].sort());
}

/* ── 5. the canaries ──────────────────────────────────────────────────────── */


export const REDACTION_CANARIES = Object.freeze({
  password: "Tr0ub4dor-CANARY-PASSWORD-3xk9qz",
  cookie: "PS_TOKEN=CANARYc0okie9f3a1b7d2e",
  storageState: "CANARYstorageState7d2e0a5c",
  privateKey: "CANARYprivateKey5a8cBEGINPRIVATE",
  credentialPath: "/Users/canary/.auth-rebuild/duo-credential-CANARY-9f21.json",
  ssn: "666-45-8811",
  dob: "1899-02-30",
  personName: "Qwertzuiop Vbnmasdfghjkl",
  emplId: "10999881777",
} as const);

export type CanaryName = keyof typeof REDACTION_CANARIES;

export const ALL_CANARY_NAMES: readonly CanaryName[] = Object.freeze(
  Object.keys(REDACTION_CANARIES) as CanaryName[],
);


export const UNIVERSAL_CANARY_NAMES: readonly CanaryName[] = Object.freeze([
  "password",
  "cookie",
  "storageState",
  "privateKey",
  "credentialPath",
  "ssn",
  "dob",
] as const);

/** Every canary that appears verbatim in `text`, named. */
export function canariesIn(text: string, names: readonly CanaryName[] = ALL_CANARY_NAMES): readonly CanaryName[] {
  return names.filter((name) => text.includes(REDACTION_CANARIES[name]));
}

/* ── 6. the registry ──────────────────────────────────────────────────────── */

export const REDACTION_SURFACES: readonly RedactionSurface[] = Object.freeze([
  { id: "durable/editable-workbook", egress: "durable-authority", module: "src/models/dashboard/workbooks.ts", schema: EditableWorkbookSchema },
  { id: "durable/saved-workbook", egress: "durable-authority", module: "src/models/dashboard/workbooks.ts", schema: SavedWorkbookSchema },
  { id: "wire/editable-workbook", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: EditableWorkbookWireSchema },
  { id: "wire/saved-workbook", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: SavedWorkbookWireSchema },
  { id: "wire/workbook-list", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookListWireSchema },
  { id: "wire/workbook-library-catalog", egress: "operator-loopback", module: "src/models/dashboard/workbook-library.ts", schema: WorkbookLibraryCatalogSchema },
  { id: "wire/workbook-compatibility", egress: "operator-loopback", module: "src/models/dashboard/workbook-library.ts", schema: WorkbookCompatibilitySchema },
  { id: "wire/workbook-library-version", egress: "operator-loopback", module: "src/models/dashboard/workbook-library.ts", schema: WorkbookLibraryVersionViewSchema },
  { id: "request/workbook-library-action", egress: "operator-loopback", module: "src/models/dashboard/workbook-library.ts", schema: WorkbookLibraryActionSchema },
  { id: "wire/workbook-library-action-result", egress: "operator-loopback", module: "src/models/dashboard/workbook-library.ts", schema: WorkbookLibraryActionResultSchema },
  { id: "wire/workbook-library-action-status", egress: "operator-loopback", module: "src/models/dashboard/workbook-library.ts", schema: WorkbookLibraryActionStatusSchema },
  { id: "durable/workbook-library-state", egress: "durable-authority", module: "src/models/dashboard/workbook-library.ts", schema: WorkbookLibraryStateSchema },
  { id: "durable/workbook-library-snapshot", egress: "durable-authority", module: "src/models/dashboard/workbook-library.ts", schema: WorkbookLibrarySnapshotSchema },
  { id: "durable/workbook-library-action", egress: "durable-authority", module: "src/models/dashboard/workbook-library.ts", schema: WorkbookLibraryActionRecordSchema },
  { id: "wire/planned-run-output", egress: "operator-loopback", module: "src/models/dashboard/run-outputs.ts", schema: PlannedRunOutputSchema },
  { id: "wire/workbook-history", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookHistoryWireSchema },
  { id: "wire/workbook-type", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookTypeSchema },
  { id: "wire/workbook-metadata", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookMetadataSchema },
  { id: "durable/workbook-operation", egress: "durable-authority", module: "src/models/dashboard/workbooks.ts", schema: WorkbookOperationSchema },
  { id: "request/workbook-operation", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookOperatorOperationRequestSchema },
  { id: "wire/workbook-operation-receipt", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookOperationReceiptSchema },
  { id: "wire/workbook-named-version", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookNamedVersionSchema },
  { id: "request/workbook-reference", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookSnapshotRequestSchema },
  { id: "wire/workbook-reference", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookSnapshotSchema },
  { id: "request/workbook-create", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookCreateRequestSchema },
  { id: "request/workbook-save", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookSaveRequestSchema },
  { id: "request/workbook-intake", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookIntakeRequestSchema },
  { id: "wire/workbook-intake", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookIntakeResultSchema },
  { id: "wire/intake-command-result", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: IntakeCommandResultWireSchema },
  { id: "wire/ocr-command-result", egress: "operator-loopback", module: "src/models/dashboard/run-detail.ts", schema: OcrCommandResultWireSchema },
  { id: "wire/worker-command-result", egress: "operator-loopback", module: "src/models/dashboard/worker-command-result.ts", schema: WorkerCommandResultWireSchema },

  { id: "wire/rerun-values", egress: "operator-loopback", module: "src/models/dashboard/rerun-values.ts", schema: RerunValuesResponseSchema },
  { id: "wire/rerun-warning", egress: "operator-loopback", module: "src/models/dashboard/rerun-warning.ts", schema: RerunWarningWireSchema },
  { id: "wire/run-detail", egress: "operator-loopback", module: "src/models/dashboard/run-detail.ts", schema: RunDetailWireSchema },
  { id: "wire/run-detail-section", egress: "operator-loopback", module: "src/models/dashboard/run-detail.ts", schema: RunDetailSectionResponseSchema },
  { id: "wire/queue-surface", egress: "operator-loopback", module: "src/models/dashboard/projection.ts", schema: QueueSurfaceWireSchema },
  { id: "wire/dashboard-day", egress: "operator-loopback", module: "src/models/dashboard/projection.ts", schema: DashboardDayWireSchema },
  { id: "wire/stream-envelope", egress: "operator-loopback", module: "src/models/dashboard/subscription.ts", schema: DashboardStreamEnvelopeSchema },
  { id: "wire/bootstrap", egress: "operator-loopback", module: "src/models/dashboard/bootstrap.ts", schema: FrontendBootstrapWireSchema },
  { id: "request/workbook-reference-write", egress: "operator-loopback", module: "src/models/processing/workbooks/read-result.ts", schema: WorkbookReferenceWriteSchema },
  { id: "wire/diagnostic-bundle", egress: "operator-loopback", module: "src/models/dashboard/diagnostic-bundle.ts", schema: DiagnosticBundleWireSchema },
  { id: "wire/activity-report", egress: "operator-loopback", module: "src/models/dashboard/activity.ts", schema: ActivityReportSelectionSchema },
  { id: "wire/activity-population", egress: "operator-loopback", module: "src/models/dashboard/activity-population.ts", schema: ActivityPopulationSelectionSchema },
  { id: "wire/activity-population-selected", egress: "operator-loopback", module: "src/models/dashboard/activity-population.ts", schema: ActivityPopulationSelectedReadSchema },
  { id: "wire/activity-population-export", egress: "operator-loopback", module: "src/models/dashboard/activity-population.ts", schema: ActivityPopulationExportSchema },
  { id: "wire/calendar", egress: "operator-loopback", module: "src/models/dashboard/calendar.ts", schema: CalendarWireSchema },
  { id: "wire/cross-date-search", egress: "operator-loopback", module: "src/models/dashboard/search.ts", schema: CrossDateSearchPageSchema },
  { id: "wire/action-descriptor", egress: "operator-loopback", module: "src/models/dashboard/actions.ts", schema: ActionDescriptorWireSchema },
  { id: "wire/artifact-resource", egress: "operator-loopback", module: "src/models/dashboard/artifacts.ts", schema: ArtifactResourceWireSchema },

  { id: "wire/capture-pointer", egress: "operator-loopback", module: "src/models/dashboard/artifacts.ts", schema: CapturePointerWireSchema },
  { id: "wire/storage-doctor", egress: "operator-loopback", module: "src/models/dashboard/storage.ts", schema: StorageDoctorWireSchema },
  { id: "request/clear-run-history", egress: "operator-loopback", module: "src/models/dashboard/run-history.ts", schema: ClearRunHistoryRequestSchema },
  { id: "wire/run-history-status", egress: "operator-loopback", module: "src/models/dashboard/run-history.ts", schema: RunHistoryStatusSchema },
  { id: "wire/clear-run-history-result", egress: "operator-loopback", module: "src/models/dashboard/run-history.ts", schema: ClearRunHistoryResultSchema },
  { id: "wire/storage-doctor-latest", egress: "operator-loopback", module: "src/models/dashboard/storage.ts", schema: StorageDoctorLatestWireSchema },
  { id: "wire/settings-facts", egress: "operator-loopback", module: "src/models/dashboard/settings.ts", schema: SettingsFactsWireSchema },
  { id: "wire/editable-settings", egress: "operator-loopback", module: "src/models/dashboard/settings-editor.ts", schema: EditableSettingsWireSchema },
  { id: "request/assistant", egress: "operator-loopback", module: "src/models/dashboard/assistant.ts", schema: AssistantRequestSchema },
  { id: "wire/assistant", egress: "operator-loopback", module: "src/models/dashboard/assistant.ts", schema: AssistantRespondEnvelopeSchema },
  { id: "request/assistant-history", egress: "operator-loopback", module: "src/models/dashboard/assistant.ts", schema: AssistantHistoryOperationSchema },
  { id: "wire/assistant-history", egress: "operator-loopback", module: "src/models/dashboard/assistant.ts", schema: AssistantHistoryViewSchema },
  { id: "wire/assistant-conversation", egress: "operator-loopback", module: "src/models/dashboard/assistant.ts", schema: AssistantConversationViewSchema },
  { id: "egress/assistant-user-message", egress: "process-egress", module: "src/backend/assistant/service.ts", schema: z.strictObject({ content: z.string() }) },
  // Replayed rows: operator turns replay as user messages (above); answers and the fixed proposal and decision captions replay as assistant messages.
  { id: "egress/assistant-replay", egress: "process-egress", module: "src/backend/assistant/service.ts", schema: z.strictObject({ answer: z.string(), caption: z.string() }) },
  ...assistantToolEgress().surfaces,
  { id: "wire/profile-first-run-check", egress: "operator-loopback", module: "src/models/profiles/public-profile.ts", schema: ProfileFirstRunCheckSchema },
  { id: "wire/chatgpt-ocr-test", egress: "operator-loopback", module: "src/models/dashboard/chatgpt-account.ts", schema: ChatGptOcrTestResultSchema },
  { id: "wire/chatgpt-account", egress: "operator-loopback", module: "src/models/dashboard/chatgpt-account.ts", schema: ChatGptAccountStatusSchema },
  { id: "wire/chatgpt-start", egress: "operator-loopback", module: "src/models/dashboard/chatgpt-account.ts", schema: ChatGptSignInStartResultSchema },
  { id: "wire/chatgpt-completion", egress: "operator-loopback", module: "src/models/dashboard/chatgpt-account.ts", schema: ChatGptSignInCompletionSchema },
  { id: "wire/chatgpt-cancel", egress: "operator-loopback", module: "src/models/dashboard/chatgpt-account.ts", schema: ChatGptCancelResultSchema },
  { id: "wire/native-path-picker", egress: "operator-loopback", module: "src/models/dashboard/native-path-picker.ts", schema: NativePathPickerResponseSchema },
  { id: "wire/workflow-explorer", egress: "operator-loopback", module: "src/models/dashboard/explorer.ts", schema: WorkflowExplorerWireSchema },
  { id: "wire/intake-session", egress: "operator-loopback", module: "src/models/intake/wire.ts", schema: IntakeSessionWireSchema },
  { id: "durable/failure-record", egress: "durable-authority", module: "src/models/trust/failure.ts", schema: FailureRecordSchema },
  { id: "durable/evidence-receipt", egress: "durable-authority", module: "src/models/trust/evidence.ts", schema: RunEvidenceReceiptSchema },
  { id: "durable/notification-record", egress: "durable-authority", module: "src/models/notifications/notifications.ts", schema: NotificationRecordSchema },
  { id: "durable/diagnostic-bundle", egress: "durable-authority", module: "src/models/trust/diagnostic.ts", schema: DiagnosticBundleSchema },
  { id: "durable/run-search-index", egress: "durable-authority", module: "src/models/dashboard/search-index.ts", schema: RunSearchIndexRecordSchema },
  { id: "durable/run-search-declaration", egress: "durable-authority", module: "src/models/dashboard/search-index.ts", schema: RunSearchDeclarationSchema },
  { id: "durable/run-search-gram", egress: "durable-authority", module: "src/models/dashboard/search-index.ts", schema: RunSearchGramSchema },
  { id: "durable/run-search-actor-link", egress: "durable-authority", module: "src/models/dashboard/search-index.ts", schema: RunSearchActorLinkSchema },
  { id: "durable/operator-xlsx-export", egress: "durable-authority", module: "src/models/dashboard/xlsx-export.ts", schema: OperatorXlsxExportEvidenceSchema },
  { id: "wire/start-plan", egress: "operator-loopback", module: "src/models/dashboard/start-plan.ts", schema: StartPlanWireSchema },
  { id: "file/ledger-entry", egress: "durable-file", module: "src/rules/runs/ledger.ts", schema: LedgerEntrySchema },

  { id: "os/notification-projection", egress: "os-notification", module: "src/rules/notifications/notification-triggers.ts", schema: NotificationProjectionSchema },
  { id: "os/notification-trigger-event", egress: "os-notification", module: "src/rules/notifications/notification-triggers.ts", schema: NotificationTriggerEventSchema },
] satisfies readonly RedactionSurface[]);


const WORKBOOK_VALUE_ORIGINS: readonly Readonly<{ path: string; origin: LeafOrigin }>[] = [
  { path: "libraryId", origin: "captured-hr-value" },
  { path: "name", origin: "captured-hr-value" },
  { path: "sheets[].columnBindings[].fieldId", origin: "captured-hr-value" },
  { path: "sheets[].columnBindings[].id", origin: "captured-hr-value" },
  { path: "sheets[].columnBindings[].sourceHeader", origin: "captured-hr-value" },
  { path: "sheets[].id", origin: "captured-hr-value" },
  { path: "sheets[].name", origin: "captured-hr-value" },
  { path: "sheets[].rows[].cells[].background", origin: "captured-hr-value" },
  { path: "sheets[].rows[].cells[].value", origin: "captured-hr-value" },
  ...["numFmt", "hyperlink", "tooltip", "richText[].text", "richText[].font.name"].map(path => ({ path: `sheets[].rows[].cells[].${path}`, origin: "captured-hr-value" as const })),
  { path: "sheets[].rows[].id", origin: "captured-hr-value" },
  { path: "themes", origin: "captured-hr-value" },
  { path: "themes[]", origin: "captured-hr-value" },
];
const LIBRARY_TYPE_ORIGINS = ['id', 'name', 'keyFieldId', 'fields[]', 'defaultWorkbookId'] as const;
const LIBRARY_MUTABLE_TYPE_ORIGINS = [...LIBRARY_TYPE_ORIGINS, 'fieldLabels', 'requiredFields[]'] as const;
const LIBRARY_METADATA_ORIGINS = ['typeId'] as const;
const LIBRARY_CHANGE_ORIGINS = ['key', 'values', 'sheetId', 'rowId', 'selection.sheetId', 'selection.rowId', 'name', 'metadata.typeId', 'resolves.operationId'] as const;
const LIBRARY_CAPTURED_WRITE_SOURCE_ORIGINS = ['source.authority.versionId', 'source.authority.sheetId', 'source.authority.keyFieldId',
  'source.authority.requiredFields[]', 'source.authority.writableFields[]'] as const;
const LIBRARY_RECEIPT_ORIGINS = ['operationId', 'libraryId', 'key', 'candidates[].sheetId', 'candidates[].rowId',
  'changes[].sheetId', 'changes[].rowId', 'changes[].fieldId', 'changes[].key', 'changes[].oldValue', 'changes[].newValue',
  'source.runId', 'source.syncId', ...LIBRARY_CAPTURED_WRITE_SOURCE_ORIGINS] as const;
const LIBRARY_VERSION_ORIGINS: readonly Readonly<{ path: string; origin: LeafOrigin }>[] = [
  ...['id', 'snapshotId'].map(path => ({ path, origin: 'repository-authored' as const })),
  { path: 'name', origin: 'operator-authored' },
];
const LIBRARY_STATE_ORIGINS: readonly Readonly<{ path: string; origin: LeafOrigin }>[] = [
  ...['libraryId', 'selectedVersionId', 'origin.workflowLabel'].map(path => ({ path, origin: 'repository-authored' as const })),
  ...LIBRARY_VERSION_ORIGINS.map(entry => ({ ...entry, path: `versions[].${entry.path}` })),
  { path: 'tags[]', origin: 'operator-authored' },
];
const LIBRARY_ACTION_ORIGINS: readonly Readonly<{ path: string; origin: LeafOrigin }>[] = [
  ...['operationId', 'change.from.versionId', 'change.versionId'].map(path => ({ path, origin: 'repository-authored' as const })),
  { path: 'change.name', origin: 'operator-authored' }, { path: 'change.tags[]', origin: 'operator-authored' }, { path: 'change.metadata.typeId', origin: 'captured-hr-value' },
  ...WORKBOOK_VALUE_ORIGINS.map(entry => ({ ...entry, path: `change.from.workbook.${entry.path}` })),
];
const PLANNED_OUTPUT_ORIGINS = ['name', 'sheetId', 'worksheetName', 'folderName', 'archiveName', 'people[].rowId', 'people[].label'] as const;
const LIBRARY_NAME_RETENTION = 'Operator-approved named workbook and version management retains entered names and manual tags in the local library state and its immutable action journal (docs/reference/data-intake-and-edit-data.md, Saved workbook reference data). This permits local authority retention only, with no process or OS notification egress.';

const OCR_REVIEW_ORIGINS: readonly Readonly<{ path: string; origin: LeafOrigin }>[] = [
  { path: "approvedSnapshots[].records[].fields.answers[].raw", origin: "captured-hr-value" },
  { path: "approvedSnapshots[].records[].fields.answers[].reason", origin: "captured-hr-value" },
  { path: "approvedSnapshots[].records[].fields.answers[].value", origin: "captured-hr-value" },
  { path: "revision.id", origin: "repository-authored" },
  { path: "revision.origin.key", origin: "repository-authored" },
  { path: "revision.records[].fields.answers[].raw", origin: "captured-hr-value" },
  { path: "revision.records[].fields.answers[].reason", origin: "captured-hr-value" },
  { path: "revision.records[].fields.answers[].value", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].input.dob", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].input.firstName", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].input.lastName", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].input.name", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.candidateEids[]", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.code", origin: "repository-authored" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.datesEid", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.details.department", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.details.eid", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.details.endDate", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.details.hrStatus", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.details.matchedEid", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.details.matchedName", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.details.name", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.details.search", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.details.startDate", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.details.terminationReason", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.activeStatus.reason", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.crmDates.dates.reason", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.output.signerName", origin: "captured-hr-value" },
  { path: "revision.seed.identities[].outcome.reason", origin: "external-text" },
  { path: "revision.seed.review.accounting.outcomes[].output.extraction.record.answers[].raw", origin: "captured-hr-value" },
  { path: "revision.seed.review.accounting.outcomes[].output.extraction.record.answers[].reason", origin: "captured-hr-value" },
  { path: "revision.seed.review.accounting.outcomes[].output.extraction.record.answers[].value", origin: "captured-hr-value" },
  { path: "revision.seed.review.accounting.outcomes[].output.extraction.source.actorId", origin: "operator-authored" },
  { path: "revision.seed.review.accounting.outcomes[].output.extraction.source.agentId", origin: "external-text" },
  { path: "revision.seed.review.accounting.outcomes[].output.extraction.source.invocation", origin: "external-text" },
  { path: "revision.seed.review.accounting.outcomes[].output.extraction.source.modelId", origin: "external-text" },
  { path: "revision.seed.review.accounting.outcomes[].output.extraction.source.providerId", origin: "external-text" },
  { path: "revision.seed.review.accounting.outcomes[].reason", origin: "external-text" },
  { path: "revision.seed.review.grouping.subjects[].displayName", origin: "captured-hr-value" },
  { path: "revision.seed.review.grouping.subjects[].matchKey", origin: "captured-hr-value" },
  { path: "revision.seed.review.records[].fields.answers[].raw", origin: "captured-hr-value" },
  { path: "revision.seed.review.records[].fields.answers[].reason", origin: "captured-hr-value" },
  { path: "revision.seed.review.records[].fields.answers[].value", origin: "captured-hr-value" },
  { path: "revision.seed.review.records[].lookup.name", origin: "captured-hr-value" },
  { path: "revision.seed.review.records[].subjectName", origin: "captured-hr-value" },
  { path: "revision.seed.review.roster.workbookId", origin: "repository-authored" },
  { path: "revision.seed.review.roster.rows[].rowId", origin: "captured-hr-value" },
  { path: "revision.seed.review.roster.rows[].sheetId", origin: "captured-hr-value" },
  { path: "revision.seed.review.roster.rows[].name", origin: "captured-hr-value" },
];

/* The answered option's label may be a picked row's name; the actor names are the local profile's own display name. */
const ANSWER_LEAF_ORIGINS: readonly (readonly [string, LeafOrigin])[] = [
  ["optionId", "repository-authored"], ["label", "captured-hr-value"], ["actor.name", "operator-authored"], ["actor.onBehalfOf.name", "operator-authored"],
];
/** A served run decision's free-text leaves: catalog and workflow-declared text, served keys, and the HR values a pick or prefill shows. */
const DECISION_LEAF_ORIGINS: readonly (readonly [string, LeafOrigin])[] = [
  ...["choiceLabel", "options[].id", "options[].label", "options[].hint", "options[].confirm.body", "options[].confirm.confirmLabel", "options[].confirm.title",
    "options[].input.label", "options[].input.pattern", "options[].input.placeholder",
    "options[].input.table.columns[].id", "options[].input.table.columns[].label", "options[].input.table.rows[].cells[].columnId",
    "options[].input.table.typed.label", "options[].input.table.typed.pattern", "options[].input.table.typed.placeholder",
    "options[].send.actionKey", "options[].send.arm", "options[].send.family", "options[].send.gateNodeId",
    "options[].send.type"].map(path => [path, "repository-authored"] as const),
  ...["title", "context", "options[].input.prefill", "options[].input.table.title", "options[].input.table.rows[].cells[].value", "options[].input.table.rows[].id",
    "options[].input.table.rows[].name", "options[].input.table.rows[].rowId", "options[].input.table.rows[].sheetId"].map(path => [path, "captured-hr-value"] as const),
  ...ANSWER_LEAF_ORIGINS.map(([path, origin]) => [`answer.${path}`, origin] as const),
];
const COMPATIBILITY_LEAF_ORIGINS: readonly (readonly [string, LeafOrigin])[] = [
  ...['workflows[].requiredWorkbookFields[]',
    'workflows[].workbookReference.id', 'workflows[].workbookReference.keyFieldId',
    'workflows[].workbookReference.writableFields[]', 'workflows[].lastUsed.sources[].libraryId',
    'workflows[].staleSources[].libraryId', 'workflows[].sources[].libraryId',
    'workflows[].sources[].versionId', 'libraries[].libraryId', 'libraries[].versionId',
    'libraries[].sheets[].workflows[].missingFields[]',
    'libraries[].sheets[].workflows[].duplicateFields[]'].map(path => [path, 'repository-authored'] as const),
  ...['workflows[].lastUsed.sources[].sheetId', 'workflows[].staleSources[].sheetId',
    'workflows[].sources[].sheetId', 'workflows[].sources[].sheetName',
    'libraries[].sheets[].sheetId', 'libraries[].sheets[].sheetName'].map(path => [path, 'captured-hr-value'] as const),
  ['libraries[].sheets[].mappings[].fieldId', 'operator-authored'],
];

export const SURFACE_LEAF_ORIGINS: readonly SurfaceLeafOrigin[] = Object.freeze(
  SurfaceLeafOriginSchema.array().parse([
    ...[
      "runOptions.mode.field", "runOptions.mode.label", "runOptions.mode.initial", "runOptions.mode.options[].value",
      "runOptions.mode.options[].label", "runOptions.mode.options[].defaults[].value.text",
      "runOptions.controls[].field", "runOptions.controls[].label", "runOptions.controls[].modes[]",
      "runOptions.controls[].requires[]", "runOptions.controls[].options[]",
      "runOptions.omittableSteps[].stepKey", "runOptions.omittableSteps[].label",
      "runOptions.omittableSteps[].form.fields[].label", "runOptions.omittableSteps[].form.fields[].help",
      "runOptions.omittableSteps[].form.fields[].values[]",
      "runOptions.upload.fields[].label", "runOptions.upload.fields[].placeholder",
      "runOptions.upload.fields[].options[].value", "runOptions.upload.fields[].options[].label",
      "sessionStep.unavailableDelegations[].reason", "sessionStep.requirements[].id",
      "sessionStep.requirements[].stepKey", "sessionStep.requirements[].stepTitle", "sessionStep.requirements[].delegationPath[].stepKey",
      "steps[].id", "steps[].title", "steps[].pages.reason", "steps[].pages.items[].id", "steps[].pages.items[].title",
      "steps[].pages.items[].lines[].id", "steps[].pages.items[].lines[].text",
      "steps[].pages.items[].fields[].id", "steps[].pages.items[].fields[].label", "steps[].pages.items[].fields[].example",
      "steps[].pages.items[].fields[].display.cases[].value", "steps[].pages.items[].fields[].display.cases[].text",
      "steps[].pages.items[].fields[].options[]", "steps[].pages.items[].fields[].source.origin",
      "steps[].pages.items[].fields[].sources[].value",
      "steps[].pages.items[].fields[].source.detail", "steps[].pages.items[].fields[].source.read.page",
      "steps[].pages.items[].fields[].source.read.field", "steps[].pages.items[].fields[].source.chain[].label",
      "steps[].pages.items[].fields[].source.chain[].detail", "steps[].pages.items[].fields[].source.chain[].read.page",
      "steps[].pages.items[].fields[].source.chain[].read.field", "steps[].decisions[].id", "steps[].decisions[].outcome",
      "steps[].decisions[].label.text", "steps[].decisions[].label.reason",
    ].map(path => ({ surface: "wire/workflow-explorer", path: `workflows[].reviewSpec.${path}`, origin: "repository-authored" })),
    ...([
      ["wire/run-detail", "decision."], ["wire/run-detail", "gate.decision."], ["wire/run-detail-section", "payload.decision."],
      ["wire/run-detail-section", "payload.value.decision."], ["wire/run-detail-section", "payload.referenceChoices[].resolution.decision."],
      ["wire/run-detail-section", "payload.operations[].resolution.decision."],
    ] as const).flatMap(([surface, prefix]) => DECISION_LEAF_ORIGINS.map(([path, origin]) => ({ surface, path: `${prefix}${path}`, origin }))),
    ...([
      ["wire/run-detail", "gate.answer."], ["wire/run-detail-section", "payload.referenceChoices[].resolution.answer."],
      ["wire/run-detail-section", "payload.operations[].resolution.answer."],
    ] as const).flatMap(([surface, prefix]) => ANSWER_LEAF_ORIGINS.map(([path, origin]) => ({ surface, path: `${prefix}${path}`, origin }))),
    ...([
      ["wire/queue-surface", "recordMembers.members[]."],
      ["wire/dashboard-day", "queueSurfaces[].recordMembers.members[]."],
      ["wire/stream-envelope", "payload.queueSurfaces[].recordMembers.members[]."],
      ["wire/stream-envelope", "payload.replacement.recordMembers.members[]."],
    ] as const).flatMap(([surface, prefix]) => [
      { surface, path: `${prefix}title`, origin: "captured-hr-value" },
      { surface, path: `${prefix}target.label`, origin: "repository-authored" },
    ]),
    { surface: "wire/queue-surface", path: "parent.label", origin: "repository-authored" },
    { surface: "wire/queue-surface", path: "parent.title", origin: "captured-hr-value" },
    { surface: "wire/dashboard-day", path: "queueSurfaces[].parent.label", origin: "repository-authored" },
    { surface: "wire/dashboard-day", path: "queueSurfaces[].parent.title", origin: "captured-hr-value" },
    { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].parent.label", origin: "repository-authored" },
    { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].parent.title", origin: "captured-hr-value" },
    { surface: "wire/stream-envelope", path: "payload.replacement.parent.label", origin: "repository-authored" },
    { surface: "wire/stream-envelope", path: "payload.replacement.parent.title", origin: "captured-hr-value" },
    { surface: 'wire/bootstrap', path: 'workflows[].start.requiredWorkbookFields[]', origin: 'repository-authored' },
    ...['id', 'keyFieldId', 'writableFields[]'].map(path => ({ surface: 'wire/bootstrap', path: `workflows[].start.workbookReference.${path}`, origin: 'repository-authored' as const })),
    { surface: 'wire/bootstrap', path: 'workflows[].start.readiness.fixAction.requiredFields[]', origin: 'repository-authored' },
    { surface: 'wire/bootstrap', path: 'workflows[].start.readiness.reason', origin: 'repository-authored' },
    ...COMPATIBILITY_LEAF_ORIGINS.flatMap(([path, origin]) => [
      { surface: 'wire/bootstrap', path: `workbookCompatibility.${path}`, origin },
      { surface: 'wire/workbook-compatibility', path, origin },
    ]),
    { surface: 'request/workbook-reference-write', path: 'typeId', origin: 'repository-authored' },
    { surface: 'request/workbook-reference-write', path: 'key', origin: 'captured-hr-value' },
    { surface: 'request/workbook-reference-write', path: 'values[].fieldId', origin: 'repository-authored' },
    { surface: 'request/workbook-reference-write', path: 'values[].value', origin: 'captured-hr-value' },
    ...PLANNED_OUTPUT_ORIGINS.flatMap(path => ['wire/planned-run-output', 'wire/start-plan'].map(surface => ({ surface,
      path: surface === 'wire/start-plan' ? `planned[].outputs[].${path}` : path, origin: 'captured-hr-value' as const }))),
    ...([
      ['wire/workbook-library-catalog', '[].state.', LIBRARY_STATE_ORIGINS],
      ['wire/workbook-library-version', 'version.', LIBRARY_VERSION_ORIGINS],
      ['request/workbook-library-action', '', LIBRARY_ACTION_ORIGINS],
      ['wire/workbook-library-action-result', 'action.', LIBRARY_ACTION_ORIGINS],
      ['wire/workbook-library-action-result', 'result.', LIBRARY_STATE_ORIGINS],
      ['wire/workbook-library-action-status', 'record.action.', LIBRARY_ACTION_ORIGINS],
      ['wire/workbook-library-action-status', 'record.result.', LIBRARY_STATE_ORIGINS],
      ['durable/workbook-library-state', '', LIBRARY_STATE_ORIGINS],
      ['durable/workbook-library-action', 'action.', LIBRARY_ACTION_ORIGINS],
      ['durable/workbook-library-action', 'result.', LIBRARY_STATE_ORIGINS],
    ] as const).flatMap(([surface, prefix, entries]) => entries.map(entry => ({ surface, path: `${prefix}${entry.path}`, origin: entry.origin,
      ...(surface.startsWith('durable/') && entry.origin === 'operator-authored' ? { exception: LIBRARY_NAME_RETENTION } : {}) }))),
    ...['wire/workbook-library-version', 'durable/workbook-library-snapshot'].flatMap(surface => [
      { surface, path: 'libraryId', origin: 'repository-authored' as const },
      ...WORKBOOK_VALUE_ORIGINS.map(entry => ({ ...entry, surface, path: `workbook.${entry.path}`, origin: entry.path === 'libraryId' ? 'repository-authored' as const : entry.origin })),
    ]),
    { surface: 'durable/workbook-library-snapshot', path: 'id', origin: 'repository-authored' },
    { surface: 'durable/workbook-library-action', path: 'libraryId', origin: 'repository-authored' },
    { surface: 'durable/workbook-library-action', path: 'action.change.sources[].libraryId', origin: 'repository-authored' },
    { surface: 'wire/workbook-library-action-status', path: 'record.libraryId', origin: 'repository-authored' },
    { surface: 'wire/workbook-library-action-result', path: 'libraryId', origin: 'repository-authored' },
    { surface: 'wire/workbook-library-catalog', path: '[].libraryId', origin: 'repository-authored' },
    ...['name', 'worksheets[].id', 'worksheets[].name', 'metadata.typeId'].map(path => ({ surface: 'wire/workbook-library-catalog', path: `[].${path}`, origin: 'captured-hr-value' as const })),
    ...LIBRARY_MUTABLE_TYPE_ORIGINS.map(path => ({ surface: 'wire/workbook-library-catalog', path: `[].type.${path}`, origin: 'captured-hr-value' as const })),
    ...['versionId', 'versionName'].map(path => ({ surface: 'wire/workbook-reference', path, origin: path === 'versionId' ? 'repository-authored' : 'operator-authored' })),
    { surface: 'request/workbook-reference', path: 'versionId', origin: 'repository-authored' },
    { surface: 'request/workbook-reference', path: 'selectedRow.sheetId', origin: 'captured-hr-value' },
    { surface: 'request/workbook-reference', path: 'selectedRow.rowId', origin: 'captured-hr-value' },
    ...['libraryId', 'versionId'].map(path => ({ surface: 'wire/start-plan', path: `planned[].workbookReferences[].${path}`, origin: 'repository-authored' as const })),
    { surface: 'wire/start-plan', path: 'planned[].workbookReferences[].versionName', origin: 'operator-authored' },
    { surface: 'wire/start-plan', path: 'planned[].workbookReferences[].selectedRow.sheetId', origin: 'captured-hr-value' },
    { surface: 'wire/start-plan', path: 'planned[].workbookReferences[].selectedRow.rowId', origin: 'captured-hr-value' },
    ...['worksheets[].sheetId', 'worksheets[].name', ...LIBRARY_TYPE_ORIGINS.map(path => `type.${path}`)].map(path => ({ surface: 'wire/start-plan', path: `planned[].workbookReferences[].${path}`, origin: 'captured-hr-value' as const })),
  ...[
    { surface: "wire/run-detail-section", prefix: "payload.ocr" },
  ].flatMap(({ surface, prefix }) => OCR_REVIEW_ORIGINS.map(({ path, origin }) => ({ surface, path: `${prefix}.${path}`, origin }))),
  { surface: "wire/ocr-command-result", path: "request.payload.fields.answers[].raw", origin: "captured-hr-value" },
  { surface: "wire/ocr-command-result", path: "request.payload.fields.answers[].reason", origin: "captured-hr-value" },
  { surface: "wire/ocr-command-result", path: "request.payload.fields.answers[].value", origin: "captured-hr-value" },
  { surface: "wire/ocr-command-result", path: "request.payload.ocrApproval.selectedRecordIds[]", origin: "repository-authored" },
  { surface: "wire/ocr-command-result", path: "request.payload.result.value", origin: "captured-hr-value" },
  { surface: "wire/ocr-command-result", path: "request.reason", origin: "operator-authored" },
  { surface: "wire/ocr-command-result", path: "result.entries", origin: "protected-value" },
  { surface: "wire/ocr-command-result", path: "result.message", origin: "captured-hr-value" },
  { surface: "wire/ocr-command-result", path: "result.workerStartup.message", origin: "repository-authored" },
  { surface: "wire/ocr-command-result", path: "result.workerStartup.detail", origin: "external-text" },
    ...[
      ['wire/action-descriptor', ''],
      ['wire/dashboard-day', 'queueSurfaces[].actions[].'],
      ['wire/queue-surface', 'actions[].'],
      ['wire/stream-envelope', 'payload.queueSurfaces[].actions[].'],
      ['wire/stream-envelope', 'payload.replacement.actions[].'],
      ['wire/run-detail-section', 'payload.actions[].'],
      ['wire/run-detail-section', 'payload.value.actions[].'],
      ['wire/run-detail-section', 'payload.value.recovery.retry.'],
      ['wire/run-detail-section', 'payload.operations[].resolution.action.'],
      ['wire/run-detail-section', 'payload.referenceChoices[].resolution.action.'],
    ].flatMap(([surface, prefix]) => [
      ...['libraryId', 'operationId'].map(field => ({ surface, path: `${prefix}workbookTarget.${field}`, origin: 'repository-authored' as const })),
      { surface, path: `${prefix}referenceTarget.libraryId`, origin: 'repository-authored' as const },
      ...['key', 'typeId'].map(field => ({ surface, path: `${prefix}referenceTarget.${field}`, origin: 'captured-hr-value' as const })),
    ]),
    ...['native.spanPath', 'libraryId', 'resolution.target.libraryId', 'resolution.action.confirm.body', 'resolution.action.confirm.confirmLabel',
      'resolution.action.confirm.title', 'resolution.action.detail', 'resolution.action.key', 'resolution.action.label',
      'resolution.action.navigate.runId'].map(path => ({ surface: 'wire/run-detail-section', path: `payload.referenceChoices[].${path}`, origin: 'repository-authored' as const })),
    ...['key', 'typeId', 'resolution.target.key', 'resolution.target.typeId'].map(path => ({ surface: 'wire/run-detail-section', path: `payload.referenceChoices[].${path}`, origin: 'captured-hr-value' as const })),
    { surface: 'wire/run-detail-section', path: 'payload.referenceChoices[].resolution.candidates[]', origin: 'captured-hr-value' as const },
    ...['candidates[]', 'selected'].flatMap(arm => ['label', 'sheetId', 'rowId', 'values[].fieldId', 'values[].value'].map(path => ({
      surface: 'wire/run-detail-section', path: `payload.referenceChoices[].resolution.${arm}.${path}`, origin: 'captured-hr-value' as const,
    }))),
    ...LIBRARY_RECEIPT_ORIGINS.map(path => ({ surface: 'wire/run-detail-section', path: `payload.operations[].receipt.${path}`, origin: 'captured-hr-value' as const })),
    ...['native.spanPath', 'resolution.action.confirm.body', 'resolution.action.confirm.confirmLabel', 'resolution.action.confirm.title',
      'resolution.action.detail', 'resolution.action.key', 'resolution.action.label', 'resolution.action.navigate.runId',
      'resolution.target.libraryId', 'resolution.target.operationId'].map(path => ({ surface: 'wire/run-detail-section', path: `payload.operations[].${path}`, origin: 'repository-authored' as const })),
    ...['label', 'sheetId', 'rowId'].map(path => ({ surface: 'wire/run-detail-section', path: `payload.operations[].resolution.candidates[].${path}`, origin: 'captured-hr-value' as const })),
    ...['versionId', 'libraryId', 'sheetId'].map(path => ({ surface: 'wire/run-detail-section', path: `payload.value.recovery.request.workbookReferences[].${path}`, origin: 'captured-hr-value' as const })),
    { surface: 'wire/run-detail-section', path: 'payload.value.recovery.request.workbookReferences[].selectedRow.sheetId', origin: 'captured-hr-value' },
    { surface: 'wire/run-detail-section', path: 'payload.value.recovery.request.workbookReferences[].selectedRow.rowId', origin: 'captured-hr-value' },
    { surface: 'wire/run-detail-section', path: 'payload.value.recovery.prefill', origin: 'captured-hr-value' },
    ...['name', 'sheetId'].map(path => ({ surface: 'wire/workbook-reference', path: `worksheets[].${path}`, origin: 'captured-hr-value' as const })),
    ...['action', 'displayedName'].map(path => ({ surface: 'wire/run-detail-section', path: `payload.ucpathFindings.findings.rows[].${path}`, origin: 'captured-hr-value' as const })),
  {"surface": "wire/run-detail-section", "path": "payload.dryRunPreview.stages[].detail", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.dryRunPreview.stages[].label", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.dryRunPreview.stages[].sample.value", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.notes[].operatorAction.label", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.notes[].operatorAction.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-detail-section", "path": "payload.observations[].displayFields[].label", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.observations[].displayFields[].value", "origin": "captured-hr-value"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].displayFields[].label", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].displayFields[].value", "origin": "captured-hr-value"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].note.operatorAction.label", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].note.operatorAction.value", "origin": "captured-hr-value"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].endedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].endedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].definitionPreview.groups[].description", "origin": "repository-authored"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].definitionPreview.groups[].operatorFields[].example", "origin": "repository-authored"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].definitionPreview.groups[].operatorFields[].label", "origin": "repository-authored"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].timeline[].description", "origin": "repository-authored"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].timeline[].operatorFields[].example", "origin": "repository-authored"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].timeline[].operatorFields[].label", "origin": "repository-authored"},
  {"surface": "wire/run-detail", "path": "timeline.events[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.notes[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.observations[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].note.native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.native.spanPath", "origin": "repository-authored"},
  { surface: "wire/activity-population", path: "population[].title", origin: "captured-hr-value" },
  { surface: "wire/activity-population", path: "population[].workflowId", origin: "repository-authored" },
  { surface: "wire/activity-population", path: "report.categories[].category.reason", origin: "repository-authored" },
  { surface: "wire/activity-population", path: "report.durations.longestMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-population", path: "report.durations.medianMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-population", path: "report.people.reason", origin: "repository-authored" },
  { surface: "wire/activity-population", path: "report.volume.buckets[].endExclusive", origin: "repository-authored" },
  { surface: "wire/activity-population", path: "report.volume.buckets[].start", origin: "repository-authored" },
  { surface: "wire/activity-population", path: "report.volume.interval.endExclusive", origin: "repository-authored" },
  { surface: "wire/activity-population", path: "report.volume.interval.start", origin: "repository-authored" },
  { surface: "wire/activity-population", path: "report.volume.timeZone", origin: "external-text" },
  { surface: "wire/activity-population", path: "report.workflows[].registration.label", origin: "repository-authored" },
  { surface: "wire/activity-population", path: "report.workflows[].registration.reason", origin: "repository-authored" },
  ...['wire/activity-population', 'wire/activity-population-selected', 'wire/activity-population-export', 'wire/activity-report'].flatMap(surface => {
    const prefix = surface === 'wire/activity-report' ? '' : surface === 'wire/activity-population' ? 'report.' : 'selection.report.';
    return [
      'days[].typicalTime.medianMs.reason',
      'failures[].registration.label', 'failures[].registration.reason', 'failures[].sentence',
      'typicalMedian.medianMs.reason',
      'workflows[].days[].typicalTime.medianMs.reason',
      'workflows[].failedAt[].reason', 'workflows[].failedAt[].title',
      'workflows[].typicalMedian.medianMs.reason',
      'workflows[].typicalTime.meanMs.reason',
    ].map(path => ({ surface, path: `${prefix}${path}`, origin: 'repository-authored' as const }));
  }),
  { surface: "wire/activity-population", path: "successfulTiming[].workflowId", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "browse.identity.browse.query", origin: "operator-authored" },
  { surface: "wire/activity-population-selected", path: "browse.identity.browse.workflow", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "browse.rows[].title", origin: "captured-hr-value" },
  { surface: "wire/activity-population-selected", path: "browse.rows[].workflowId", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "browse.run.title", origin: "captured-hr-value" },
  { surface: "wire/activity-population-selected", path: "browse.run.workflowId", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.population[].title", origin: "captured-hr-value" },
  { surface: "wire/activity-population-selected", path: "selection.population[].workflowId", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.report.categories[].category.reason", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.report.durations.longestMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.report.durations.medianMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.report.people.reason", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.report.volume.buckets[].endExclusive", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.report.volume.buckets[].start", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.report.volume.interval.endExclusive", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.report.volume.interval.start", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.report.volume.timeZone", origin: "external-text" },
  { surface: "wire/activity-population-selected", path: "selection.report.workflows[].registration.label", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.report.workflows[].registration.reason", origin: "repository-authored" },
  { surface: "wire/activity-population-selected", path: "selection.successfulTiming[].workflowId", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "csv", origin: "captured-hr-value" },
  { surface: "wire/activity-population-export", path: "filename", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.population[].title", origin: "captured-hr-value" },
  { surface: "wire/activity-population-export", path: "selection.population[].workflowId", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.report.categories[].category.reason", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.report.durations.longestMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.report.durations.medianMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.report.people.reason", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.report.volume.buckets[].endExclusive", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.report.volume.buckets[].start", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.report.volume.interval.endExclusive", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.report.volume.interval.start", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.report.volume.timeZone", origin: "external-text" },
  { surface: "wire/activity-population-export", path: "selection.report.workflows[].registration.label", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.report.workflows[].registration.reason", origin: "repository-authored" },
  { surface: "wire/activity-population-export", path: "selection.successfulTiming[].workflowId", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "publication.notification.context.subject", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "publication.notification.context.workflow", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "publication.notification.summary", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "publication.notification.title", origin: "repository-authored" },
  { surface: "wire/workbook-intake", path: "session.columns[].header", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.columns[].normalizedHeader", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.columns[].samples[]", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.constants[].value", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.corrections[].correctedValue", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.exclusions[].reason", origin: "operator-authored" },
  { surface: "wire/workbook-intake", path: "session.headerCandidates[].cells[]", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.manifest.validRows[].parsedInput", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.rerun.diff.added[].parsedInput", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.rerun.diff.changes[].now", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.rerun.diff.changes[].was", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.rerun.diff.removed[].parsedInput", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.sheet", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.sheets[]", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.sourceName", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.workbookSource.libraryId", origin: "repository-authored" },
  { surface: "wire/workbook-intake", path: "session.targets[].label", origin: "repository-authored" },
  { surface: "wire/workbook-intake", path: "session.validation.rejected[].column.header", origin: "captured-hr-value" },
  { surface: "wire/workbook-intake", path: "session.validation.rejected[].issues[].code", origin: "repository-authored" },
  { surface: "wire/workbook-intake", path: "session.validation.rejected[].issues[].message", origin: "repository-authored" },
  { surface: "wire/workbook-intake", path: "session.validation.rejected[].issues[].path[]", origin: "repository-authored" },
  { surface: "wire/workbook-intake", path: "session.validation.rejected[].path[]", origin: "repository-authored" },
  { surface: "wire/workbook-intake", path: "session.validation.rejected[].reason", origin: "repository-authored" },

  ...["durable/editable-workbook", "wire/editable-workbook"].flatMap(surface => WORKBOOK_VALUE_ORIGINS.map(entry => ({ ...entry, surface }))),
  ...["durable/saved-workbook", "wire/saved-workbook", "request/workbook-create", "request/workbook-save"].flatMap(surface => [
    ...(surface.startsWith("request/") ? [] : [{ surface, path: "libraryId", origin: "repository-authored" as const }]),
    ...WORKBOOK_VALUE_ORIGINS.map(entry => ({ ...entry, surface, path: `workbook.${entry.path}`, origin: entry.path === "libraryId" && !surface.startsWith("request/") ? "repository-authored" as const : entry.origin })),
  ]),
  ...["wire/workbook-list", "wire/workbook-history"].flatMap(surface => [
    { surface, path: "[].libraryId", origin: "repository-authored" as const },
    ...WORKBOOK_VALUE_ORIGINS.map(entry => ({ ...entry, surface, path: `[].workbook.${entry.path}`, origin: entry.path === "libraryId" ? "repository-authored" as const : entry.origin })),
  ]),
  ...LIBRARY_MUTABLE_TYPE_ORIGINS.map(path => ({ surface: 'wire/workbook-type', path, origin: 'captured-hr-value' as const })),
  ...LIBRARY_METADATA_ORIGINS.map(path => ({ surface: 'wire/workbook-metadata', path, origin: 'captured-hr-value' as const })),
  ...LIBRARY_CHANGE_ORIGINS.flatMap(path => ['request/workbook-operation', 'durable/workbook-operation'].map(surface => ({ surface,
    path: surface.startsWith('durable/') ? `change.${path}` : path, origin: path === 'name' ? 'operator-authored' as const : 'captured-hr-value' as const,
    ...(surface === 'durable/workbook-operation' && path === 'name' ? { exception: 'Operator-approved manual named-version retention (docs/reference/data-intake-and-edit-data.md, Saved workbook reference data) preserves the operator-entered name in local durable workbook authority and its operation journal only; it does not authorize process or OS notification egress.' } : {}) }))),
  ...WORKBOOK_VALUE_ORIGINS.flatMap(entry => ['request/workbook-operation', 'durable/workbook-operation'].map(surface => ({ surface,
    path: `${surface.startsWith('durable/') ? 'change.' : ''}workbook.${entry.path}`, origin: entry.origin }))),
  ...['operationId', 'source.runId', 'source.syncId', ...LIBRARY_CAPTURED_WRITE_SOURCE_ORIGINS].map(path => ({ surface: 'durable/workbook-operation', path, origin: 'captured-hr-value' as const })),
  ...LIBRARY_RECEIPT_ORIGINS.map(path => ({ surface: 'wire/workbook-operation-receipt', path, origin: 'captured-hr-value' as const })),
  { surface: 'wire/workbook-named-version', path: 'name', origin: 'operator-authored' },
  { surface: 'wire/workbook-named-version', path: 'snapshot.libraryId', origin: 'repository-authored' },
  ...WORKBOOK_VALUE_ORIGINS.map(entry => ({ surface: 'wire/workbook-named-version', path: `snapshot.workbook.${entry.path}`, origin: entry.path === 'libraryId' ? 'repository-authored' as const : entry.origin })),
  ...['typeId', 'libraryId', 'keys[]', 'fields[]'].map(path => ({ surface: 'request/workbook-reference', path, origin: 'captured-hr-value' as const })),
  { surface: 'wire/workbook-reference', path: 'libraryId', origin: 'repository-authored' },
  ...LIBRARY_TYPE_ORIGINS.map(path => ({ surface: 'wire/workbook-reference', path: `type.${path}`, origin: 'captured-hr-value' as const })),
  ...['rows[].key', 'rows[].matches[].sheetId', 'rows[].matches[].rowId', 'rows[].matches[].values'].map(path => ({ surface: 'wire/workbook-reference', path, origin: 'captured-hr-value' as const })),
  { surface: "wire/workbook-intake", path: "code", origin: "repository-authored" },
  { surface: "wire/workbook-intake", path: "message", origin: "captured-hr-value" },
  { surface: "wire/intake-command-result", path: "request.payload.correctedValue", origin: "captured-hr-value" },
  { surface: "wire/intake-command-result", path: "request.payload.reason", origin: "operator-authored" },
  { surface: "wire/intake-command-result", path: "request.payload.sheet", origin: "captured-hr-value" },
  { surface: "wire/intake-command-result", path: "request.reason", origin: "operator-authored" },
  { surface: "wire/intake-command-result", path: "result.entries", origin: "protected-value" },
  { surface: "wire/intake-command-result", path: "result.message", origin: "captured-hr-value" },
  { surface: "wire/intake-command-result", path: "result.workerStartup.message", origin: "repository-authored" },
  { surface: "wire/intake-command-result", path: "result.workerStartup.detail", origin: "external-text" },
  { surface: "wire/worker-command-result", path: "request.reason", origin: "operator-authored" },
  { surface: "wire/worker-command-result", path: "result.entries", origin: "protected-value" },
  { surface: "wire/worker-command-result", path: "result.message", origin: "captured-hr-value" },
  { surface: "wire/worker-command-result", path: "result.workerStartup.message", origin: "repository-authored" },
  { surface: "wire/worker-command-result", path: "result.workerStartup.detail", origin: "external-text" },

  {"surface": "wire/dashboard-day", "path": "workerAuthority.reason", "origin": "external-text"},
  {"surface": "wire/stream-envelope", "path": "payload.workerAuthority.reason", "origin": "external-text"},
  { surface: "wire/run-detail-section", path: "payload.rows[].displayFields[].causal.declaration", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.rows[].displayFields[].causal.origin.path[]", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.rows[].displayFields[].causal.origin.spanPath", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.rows[].points[].origins[].origin.path[]", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.rows[].points[].origins[].origin.spanPath", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.rows[].points[].origins[].path[]", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.observations[].displayFields[].causal.declaration", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.observations[].displayFields[].causal.origin.path[]", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.observations[].displayFields[].causal.origin.spanPath", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.observations[].points[].origins[].origin.path[]", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.observations[].points[].origins[].origin.spanPath", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.observations[].points[].origins[].path[]", origin: "captured-hr-value" },
  { surface: "wire/workflow-explorer", path: "workflows[].definitionPreview.groups[].operatorFields[].display.cases[].text", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].definitionPreview.groups[].operatorFields[].display.cases[].value", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].timeline[].operatorFields[].display.cases[].text", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].timeline[].operatorFields[].display.cases[].value", origin: "repository-authored" },
  { surface: "request/assistant", path: "message", origin: "operator-authored" },
  ...["title", "draft", "composer"].flatMap(path => [{ surface: "request/assistant-history", path, origin: "operator-authored" as const },
    { surface: "wire/assistant-conversation", path, origin: "operator-authored" as const }]),
  { surface: "request/assistant-history", path: "text", origin: "repository-authored" },
  { surface: "request/assistant-history", path: "messages[].text", origin: "external-text" },
  { surface: "wire/assistant-history", path: "chats[].title", origin: "operator-authored" },
  { surface: "wire/assistant-conversation", path: "messages[].text", origin: "external-text" },
  { surface: "wire/assistant-conversation", path: "messages[].attachments[].name", origin: "local-filesystem-name" },
  { surface: "egress/assistant-user-message", path: "content", origin: "operator-authored",
    exception: "Operator decision D1 (11-06): the operator's typed assistant message is sent to ChatGPT as typed, after maskOperatorText replaces Employee IDs with references and SSNs, emails, phone numbers and long digit runs with fixed markers." },
  { surface: "egress/assistant-replay", path: "answer", origin: "external-text",
    exception: "Operator decision D3 (11-06): a stored answer's model text, which carries references and never substituted values, is replayed to ChatGPT in later turns of the same chat; imported and local rows never replay." },
  { surface: "egress/assistant-replay", path: "caption", origin: "repository-authored" },
  ...assistantToolEgress().origins,
  { surface: "wire/assistant", path: "result.text", origin: "external-text" },
  { surface: "wire/assistant", path: "result.message", origin: "repository-authored" },
  { surface: "wire/assistant", path: "result.proposal.workflowId", origin: "repository-authored" },
  { surface: "wire/assistant", path: "result.proposal.label", origin: "repository-authored" },
  { surface: "wire/assistant", path: "result.proposal.targetLabel", origin: "captured-hr-value" },
  { surface: "wire/assistant", path: "result.action.workflowId", origin: "repository-authored" },
  { surface: "wire/assistant", path: "result.action.label", origin: "repository-authored" },
  { surface: "wire/assistant", path: "result.action.targetLabel", origin: "captured-hr-value" },
  ...["action", "proposal"].flatMap(root => ["row.display.fileName", "startPlan.planned[].display.fileName"].map(path => ({ surface: "wire/assistant", path: `result.${root}.${path}`, origin: "local-filesystem-name" as const }))),
  { surface: "wire/assistant", path: "result.proposal.facts[].label", origin: "repository-authored" },
  { surface: "wire/assistant", path: "result.proposal.facts[].value", origin: "captured-hr-value" },
  { surface: "wire/assistant", path: "result.action.facts[].label", origin: "repository-authored" },
  { surface: "wire/assistant", path: "result.action.facts[].value", origin: "captured-hr-value" },
  ...["action", "proposal"].flatMap(root => ["row.display.documentNumber", "row.display.name", "row.subtitle", "row.title",
    "startPlan.planned[].display.documentNumber", "startPlan.planned[].display.name"].map(path => ({ surface: "wire/assistant", path: `result.${root}.${path}`, origin: "captured-hr-value" as const }))),
  { surface: "wire/assistant", path: "result.proposal.startPlan.planned[].title", origin: "captured-hr-value" },
  { surface: "wire/assistant", path: "result.proposal.startPlan.planned[].subtitle", origin: "captured-hr-value" },
  { surface: "wire/assistant", path: "result.action.startPlan.planned[].title", origin: "captured-hr-value" },
  { surface: "wire/assistant", path: "result.action.startPlan.planned[].subtitle", origin: "captured-hr-value" },
  { surface: "wire/chatgpt-ocr-test", path: "model", origin: "external-text" },
  { surface: "wire/profile-first-run-check", path: "report.results[].summary", origin: "local-filesystem-name" },
  { surface: "wire/profile-first-run-check", path: "report.results[].availableFor[]", origin: "repository-authored" },
  { surface: "wire/profile-first-run-check", path: "report.results[].impact", origin: "repository-authored" },
  { surface: "wire/profile-first-run-check", path: "report.results[].remediation", origin: "repository-authored" },
  { surface: "wire/chatgpt-ocr-test", path: "message", origin: "repository-authored" },
  { surface: "wire/chatgpt-account", path: "account.account.message", origin: "repository-authored" },
  { surface: "wire/chatgpt-account", path: "account.account.name", origin: "external-text" },
  { surface: "wire/chatgpt-account", path: "account.message", origin: "repository-authored" },
  { surface: "wire/chatgpt-account", path: "account.name", origin: "external-text" },
  { surface: "wire/chatgpt-start", path: "message", origin: "repository-authored" },
  { surface: "wire/chatgpt-completion", path: "account.message", origin: "repository-authored" },
  { surface: "wire/chatgpt-completion", path: "account.name", origin: "external-text" },
  { surface: "wire/chatgpt-completion", path: "message", origin: "repository-authored" },
  { surface: "wire/chatgpt-cancel", path: "message", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.display.observation", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.display.title", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "notifications[].context.subject", origin: "captured-hr-value" },
  { surface: "wire/dashboard-day", path: "notifications[].context.workflow", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.notifications[].context.subject", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.notifications[].context.workflow", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].definitionPreview.groups[].key", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].definitionPreview.groups[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].definitionPreview.reason", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "serverClock.zone", origin: "external-text" },
  { surface: "wire/activity-report", path: "volume.timeZone", origin: "external-text" },
  { surface: "wire/activity-report", path: "volume.interval.start", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "volume.interval.endExclusive", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "volume.buckets[].start", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "volume.buckets[].endExclusive", origin: "repository-authored" },

  { surface: "wire/run-detail-section", path: "payload.value.resolution.capture.resolution.note", origin: "operator-authored" },
  { surface: "wire/run-detail", path: "gate.label", origin: "repository-authored" },
  { surface: "wire/run-detail", path: "timeline.events[].durationMs.reason", origin: "repository-authored" },
  { surface: "wire/run-detail", path: "gate.reason", origin: "repository-authored" },
  { surface: "wire/run-detail", path: "header.title", origin: "captured-hr-value" },
  { surface: "wire/run-detail", path: "outcome.reason", origin: "repository-authored" },
  { surface: "wire/run-detail", path: "timeline.events[].label", origin: "repository-authored" },
  { surface: "wire/run-detail", path: "timeline.steps[].label", origin: "repository-authored" },
  { surface: "wire/run-detail", path: "timeline.steps[].members[].label", origin: "repository-authored" },
  { surface: "wire/run-detail", path: "timeline.events[].notRun.reason", origin: "repository-authored" },
  { surface: "wire/run-detail", path: "captures.message", origin: "repository-authored" },
  { surface: "wire/run-detail", path: "captures.reason", origin: "repository-authored" },


  { surface: "wire/run-detail-section", path: "payload.entries[].label", origin: "repository-authored" },

  { surface: "wire/run-detail-section", path: "payload.entries[].origin.step", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.entries[].freshness.feeds[].label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.entries[].valueRedacted", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.members[].label", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.message", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.notes[].message", origin: "external-text" },
  { surface: "wire/run-detail-section", path: "payload.notes[].fields[].key", origin: "external-text" },
  { surface: "wire/run-detail-section", path: "payload.notes[].fields[].value", origin: "external-text" },
  { surface: "wire/run-detail-section", path: "payload.rows[].note.message", origin: "external-text" },
  { surface: "wire/run-detail-section", path: "payload.rows[].note.fields[].key", origin: "external-text" },
  { surface: "wire/run-detail-section", path: "payload.rows[].note.fields[].value", origin: "external-text" },
  { surface: "wire/run-detail-section", path: "payload.observations[].producer.step", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.observations[].spanPath", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.input[].source.eventId", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.input[].source.sourceId", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.observations[].source.eventId", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.observations[].source.sourceId", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.output[].source.eventId", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.output[].source.sourceId", origin: "captured-hr-value" },


  { surface: "wire/editable-settings", path: "catalog[].schema", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "deployment", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "protectedSettings.readback.entries", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "protectedSettings.entries.ucpathPassword.value", origin: "protected-value" },
  { surface: "wire/editable-settings", path: "protectedSettings.entries.ucpathUserId.value", origin: "protected-value" },
  { surface: "wire/editable-settings", path: "protectedSettings.rows[].label", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "protectedSettings.rows[].purpose", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].catalogKey", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].control.fields[].name", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].path", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].defaultValue[]", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].activeValue", origin: "operator-authored" },
  { surface: "wire/native-path-picker", path: "path", origin: "external-text" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].activeValue[]", origin: "operator-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].effectiveValue[]", origin: "operator-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].settingsValue[]", origin: "operator-authored" },
  { surface: "wire/editable-settings", path: "sections[].description", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "sections[].label", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].defaultValue", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].description", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].effectiveValue", origin: "operator-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].hazard", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].label", origin: "repository-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].settingsValue", origin: "operator-authored" },
  { surface: "wire/editable-settings", path: "sections[].leaves[].unit", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.rows[].producer.step", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.rows[].spanPath", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.records[].label", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.causeChain[].summary", origin: "external-text" },
  { surface: "wire/run-detail-section", path: "payload.value.decisions[].reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.diagnosticBundle.reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.input[].reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.observations[].reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.output[].reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.page.titleRedacted", origin: "declared-redacted" },
  { surface: "wire/run-detail-section", path: "payload.value.page.urlRedacted", origin: "declared-redacted" },
  { surface: "wire/run-detail-section", path: "payload.value.remediation[].message", origin: "external-text" },
  { surface: "wire/run-detail-section", path: "payload.value.subject.expected.displayRedacted", origin: "declared-redacted" },
  { surface: "wire/run-detail-section", path: "payload.value.subject.observed.displayRedacted", origin: "declared-redacted" },
  { surface: "wire/run-detail-section", path: "payload.value.subject.reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.summary", origin: "external-text" },
  { surface: "wire/run-detail-section", path: "payload.value.warnings[].summary", origin: "external-text" },





  { surface: "wire/run-detail-section", path: "payload.actions[].confirm.body", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].confirm.confirmLabel", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].confirm.title", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].detail", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].key", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].navigate.runId", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.parkedMessage", origin: "external-text" },


  { surface: "wire/run-detail-section", path: "payload.proofContract.fields[].options[]", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.proofContract.fields[].pattern", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.proofContract.fields[].value", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.proofContract.reason", origin: "repository-authored" },


  { surface: "wire/run-detail-section", path: "payload.value.label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.actions[].confirm.body", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.actions[].confirm.confirmLabel", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.actions[].confirm.title", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.actions[].detail", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.actions[].key", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.actions[].label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.actions[].navigate.runId", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.options[].displayName", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.options[].origin", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.comparisons[].label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.comparisons[].request", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.comparisons[].ucpath", origin: "captured-hr-value" },


  { surface: "os/notification-trigger-event", path: "summary", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "appVersion.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "endedAt.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "gateOpenedAt.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "displayName.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "displayName.value", origin: "external-text" },
  { surface: "wire/queue-surface", path: "liveMessage.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "liveMessage.value", origin: "external-text" },
  { surface: "wire/queue-surface", path: "notStarting.summary", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "outcome.label", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "pipeline[].label", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "subtitle.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "subtitle.value", origin: "captured-hr-value" },
  { surface: "wire/queue-surface", path: "title", origin: "captured-hr-value" },
  { surface: "wire/queue-surface", path: "warnings.first", origin: "external-text" },
  { surface: "wire/queue-surface", path: "warnings.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "runNumber.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "session.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "facts.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "facts.value[].label", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "facts.value[].value", origin: "captured-hr-value" },
  { surface: "wire/queue-surface", path: "linkedRuns[].label", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "memberPreview.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "memberPreview.value", origin: "captured-hr-value" },


  { surface: "wire/queue-surface", path: "actions[].confirm.body", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].confirm.confirmLabel", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].confirm.title", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].detail", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].key", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].label", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].navigate.runId", origin: "repository-authored" },

  { surface: "wire/dashboard-day", path: "notifications[].summary", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "notifications[].title", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].appVersion.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].endedAt.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].gateOpenedAt.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].displayName.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].displayName.value", origin: "external-text" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].liveMessage.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].liveMessage.value", origin: "external-text" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].notStarting.summary", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].outcome.label", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].pipeline[].label", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].runNumber.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].session.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].facts.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].facts.value[].label", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].facts.value[].value", origin: "captured-hr-value" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].linkedRuns[].label", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].memberPreview.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].memberPreview.value", origin: "captured-hr-value" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].subtitle.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].subtitle.value", origin: "captured-hr-value" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].title", origin: "captured-hr-value" },
  { surface: "wire/rerun-values", path: "snapshot.steps[].key", origin: "repository-authored" },
  { surface: "wire/rerun-values", path: "snapshot.sourceInput.value", origin: "captured-hr-value" },
  { surface: "wire/rerun-values", path: "snapshot.values[].label", origin: "repository-authored" },
  { surface: "wire/rerun-values", path: "snapshot.values[].targetStepKey", origin: "repository-authored" },
  { surface: "wire/rerun-values", path: "snapshot.values[].sourceStepKey", origin: "repository-authored" },
  { surface: "wire/rerun-values", path: "snapshot.values[].value", origin: "captured-hr-value" },
  { surface: "wire/rerun-values", path: "snapshot.transactions[].stepKey", origin: "repository-authored" },
  {"surface": "wire/rerun-warning", "path": "rerun.source.failureCorrection.failureId", "origin": "repository-authored"},
  {"surface": "wire/rerun-warning", "path": "rerun.source.failureCorrection.inputField", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.confirm.body", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.confirm.confirmLabel", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.confirm.title", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.correction.actionLabel", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.correction.code", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.correction.label", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.correction.nodeId", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.correction.pattern", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.request.requestedInstance", "origin": "operator-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.request.rerunSource.copiedFrom[].targetStepKey", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.request.rerunSource.failureCorrection.failureId", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.request.rerunSource.failureCorrection.inputField", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.request.rerunSource.selectedStepKeys[]", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.request.selectedStepKeys[]", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.request.stepOmissions[].facts", "origin": "captured-hr-value"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.request.submissions[]", "origin": "captured-hr-value"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.retry.confirm.body", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.retry.confirm.confirmLabel", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.retry.confirm.title", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.retry.detail", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.retry.key", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.retry.label", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.recovery.retry.navigate.runId", "origin": "repository-authored"},
  {"surface": "wire/start-plan", "path": "rerun.source.failureCorrection.failureId", "origin": "repository-authored"},
  {"surface": "wire/start-plan", "path": "rerun.source.failureCorrection.inputField", "origin": "repository-authored"},
  { surface: "wire/start-plan", path: "planned[].logicalKey", origin: "repository-authored" },
  { surface: "wire/start-plan", path: "rerun.source.selectedStepKeys[]", origin: "repository-authored" },
  { surface: "wire/start-plan", path: "rerun.source.copiedFrom[].targetStepKey", origin: "repository-authored" },
  { surface: "wire/rerun-warning", path: "rerun.source.selectedStepKeys[]", origin: "repository-authored" },
  { surface: "wire/rerun-warning", path: "rerun.source.copiedFrom[].targetStepKey", origin: "repository-authored" },
  { surface: "wire/start-plan", path: "planned[].title", origin: "captured-hr-value" },
  { surface: "wire/start-plan", path: "planned[].subtitle", origin: "captured-hr-value" },
  { surface: "wire/start-plan", path: "planned[].matchKey", origin: "captured-hr-value" },
  { surface: "wire/start-plan", path: "refused[].message", origin: "captured-hr-value" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].warnings.first", origin: "external-text" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].warnings.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].actions[].confirm.body", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].actions[].confirm.confirmLabel", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].actions[].confirm.title", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].actions[].detail", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].actions[].key", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].actions[].label", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].actions[].navigate.runId", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "workerCards[].currentRun.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "workerCards[].refusal.summary", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "workerCards[].browserRequirements.reason", origin: "repository-authored" },
  // Sessions: projector-authored reasons, parsed prod/test instance, and bounded worker-control outcomes.
  { surface: "wire/dashboard-day", path: "workerCards[].browsers[].observation.instance", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "workerCards[].browsers[].observation.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "workerCards[].lastBrowsers[].observation.instance", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "workerCards[].lastBrowsers[].observation.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "workerCards[].controls.basis.reason", origin: "repository-authored" },


  { surface: "wire/stream-envelope", path: "payload.notifications[].summary", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.notifications[].title", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].appVersion.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].endedAt.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].gateOpenedAt.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].displayName.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].displayName.value", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].liveMessage.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].liveMessage.value", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].notStarting.summary", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].outcome.label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].pipeline[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].subtitle.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].subtitle.value", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].title", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].warnings.first", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].actions[].confirm.body", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].actions[].confirm.confirmLabel", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].actions[].confirm.title", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].actions[].detail", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].actions[].key", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].actions[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].actions[].navigate.runId", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.actions[].confirm.body", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.actions[].confirm.confirmLabel", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.actions[].confirm.title", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.actions[].detail", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.actions[].key", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.actions[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.actions[].navigate.runId", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].warnings.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.appVersion.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.endedAt.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.gateOpenedAt.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.displayName.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.displayName.value", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.replacement.liveMessage.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.liveMessage.value", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.replacement.notStarting.summary", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.outcome.label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.pipeline[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.subtitle.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.subtitle.value", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.replacement.warnings.first", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.replacement.warnings.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.title", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].currentRun.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].refusal.summary", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].browserRequirements.reason", origin: "repository-authored" },
  // Sessions: projector-authored reasons, parsed prod/test instance, and bounded worker-control outcomes.
  { surface: "wire/stream-envelope", path: "payload.workerCards[].browsers[].observation.instance", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].browsers[].observation.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].lastBrowsers[].observation.instance", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].lastBrowsers[].observation.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].controls.basis.reason", origin: "repository-authored" },

  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].runNumber.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].session.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].facts.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].facts.value[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].facts.value[].value", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].linkedRuns[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].memberPreview.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].memberPreview.value", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.replacement.runNumber.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.session.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.facts.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.facts.value[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.facts.value[].value", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.replacement.linkedRuns[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.memberPreview.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.memberPreview.value", origin: "captured-hr-value" },

  { surface: "wire/bootstrap", path: "actor.label", origin: "operator-authored" },
  { surface: "wire/bootstrap", path: "featureAvailability[].availability.reason", origin: "repository-authored" },

  { surface: "wire/bootstrap", path: "preflight[].blocks[]", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "preflight[].detail", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "preflight[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "preflight[].remediation", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "settingsSections[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "systemInstances[].test.reason", origin: "repository-authored" },

  { surface: "wire/bootstrap", path: "workflows[].availability.reason", origin: "repository-authored" },
  // WorkflowCodeSchema limits values to lowercase short codes, so no free-text disposition is required.
  { surface: "wire/bootstrap", path: "workflows[].label", origin: "repository-authored" },

  { surface: "wire/bootstrap", path: "workflows[].start.summary", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.uploadRun.fields[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.uploadRun.fields[].options[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.uploadRun.fields[].options[].value", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.uploadRun.fields[].placeholder", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.uploadRun.successMessage.segments[].plural", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.uploadRun.successMessage.segments[].singular", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.uploadRun.successMessage.segments[].text", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.uploadRun.title.segments[].plural", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.uploadRun.title.segments[].singular", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.uploadRun.title.segments[].text", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.placeholder", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.workbookRows.typeId", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.parser.split.delimiters[]", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.parser.constants[].value.text", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.controls[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.controls[].modes[]", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.description", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.initialMode", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modeLabel", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].defaults[].value.text", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].display.missing", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].display.separator", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].hint", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].inputLabel", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].parser.delimiter", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].parser.missing", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].parser.spec.constants[].value.text", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].parser.spec.split.delimiters[]", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].placeholder", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.typedInput.modes[].value", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.examples[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.examples[].note", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.examples[].text", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.steps[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.steps[].control.inputField", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.steps[].control.reason", origin: "repository-authored" },

  { surface: "wire/bootstrap", path: "workflows[].start.steps[].control.form.fields[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.steps[].control.form.fields[].help", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.steps[].control.form.fields[].values[]", origin: "repository-authored" },

  { surface: "wire/activity-report", path: "categories[].category.reason", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "durations.longestMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "durations.medianMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "people.reason", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "workflows[].registration.label", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "workflows[].registration.reason", origin: "repository-authored" },


  { surface: "wire/cross-date-search", path: "nextCursor.reason", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "nextCursor.value", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "snapshot.token", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "results[].metadata.actor.value", origin: "captured-hr-value" },
  { surface: "wire/cross-date-search", path: "results[].metadata.subject.value", origin: "captured-hr-value" },
  { surface: "wire/cross-date-search", path: "results[].registration.categoryId", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "results[].registration.code", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "results[].registration.label", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "results[].registration.reason", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "results[].endedAt.reason", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "results[].retryOf.reason", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "results[].runNumber.reason", origin: "repository-authored" },


  { surface: "wire/action-descriptor", path: "confirm.body", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "confirm.confirmLabel", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "confirm.title", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "detail", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "key", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "label", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "navigate.runId", origin: "repository-authored" },

  { surface: "wire/artifact-resource", path: "message", origin: "repository-authored" },
  { surface: "wire/artifact-resource", path: "reason", origin: "repository-authored" },



  { surface: "wire/capture-pointer", path: "dimensions.reason", origin: "repository-authored" },

  { surface: "wire/storage-doctor", path: "authorityUpgrades.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "authorityUpgrades.cause.summary", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "recovery.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "recovery.cause.summary", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "protectedSettings.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "protectedSettings.cause.summary", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "authority.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "authority.cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor", path: "backup.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "backup.cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor", path: "backup.latest.backupFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor", path: "backup.latest.generationGap.reason", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "backup.latest.restoreEligibility.reason", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "backup.latest.manifestFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor", path: "counts.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "counts.cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor", path: "spanAuthority.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "spanAuthority.cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor", path: "spanAuthority.problems[].summary", origin: "external-text" },
  { surface: "wire/storage-doctor", path: "restoreCandidates[].backupFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor", path: "restoreCandidates[].cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "restoreCandidates[].cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor", path: "restoreCandidates[].generationGap.reason", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "restoreCandidates[].restoreEligibility.reason", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "restoreCandidates[].manifestFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor", path: "previousLocationBackups[].backupFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor", path: "previousLocationBackups[].manifestFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor", path: "service.message", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "service.reason", origin: "repository-authored" },

  { surface: "wire/storage-doctor", path: "spanAuthority.problems[].recordKey", origin: "repository-authored" },

  { surface: "wire/storage-doctor-latest", path: "report.authorityUpgrades.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.authorityUpgrades.cause.summary", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.recovery.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.recovery.cause.summary", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.protectedSettings.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.protectedSettings.cause.summary", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.authority.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.authority.cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor-latest", path: "report.backup.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.backup.cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor-latest", path: "report.backup.latest.backupFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor-latest", path: "report.backup.latest.generationGap.reason", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.backup.latest.restoreEligibility.reason", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.backup.latest.manifestFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor-latest", path: "report.counts.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.counts.cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor-latest", path: "report.spanAuthority.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.spanAuthority.cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor-latest", path: "report.spanAuthority.problems[].summary", origin: "external-text" },
  { surface: "wire/storage-doctor-latest", path: "report.restoreCandidates[].backupFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor-latest", path: "report.restoreCandidates[].cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.restoreCandidates[].cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor-latest", path: "report.restoreCandidates[].generationGap.reason", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.restoreCandidates[].restoreEligibility.reason", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.restoreCandidates[].manifestFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor-latest", path: "report.previousLocationBackups[].backupFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor-latest", path: "report.previousLocationBackups[].manifestFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor-latest", path: "report.service.message", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.service.reason", origin: "repository-authored" },
  { surface: "wire/storage-doctor-latest", path: "report.spanAuthority.problems[].recordKey", origin: "repository-authored" },

  { surface: "wire/workflow-explorer", path: "workflows[].actions[]", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].category", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].edges[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].enqueue", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].icon", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].inputSubject.value", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].label", origin: "operator-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].timeline[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].coveragePoints[].detail", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].coveragePoints[].id", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].details[].key", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].details[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].editableFields[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].label", origin: "repository-authored" },

  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].purpose.text", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].purpose.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].summary.text", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].summary.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.branches[].id", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.cases[].name", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.edgeId", origin: "repository-authored" },

  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.condition.value", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.statusKey", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].binding.note", origin: "repository-authored" },

  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].fields[].options[]", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].fields[].recorded.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].binding.storeNamespace", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].contractSource.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].implSource.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].subject.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].subject.reviewedReasonId", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].title", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].ui[].catalogId", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].ui[].driverSource", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].ui[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].ui[].verifiedAt", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].writeSafety.recoveryAbsence.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].writeSafety.unverifiableByPage.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].scenarios[].source.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].sources.descriptor.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].sources.module.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].surfaces.inputRun.placeholder", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].surfaces.intake.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].systems[]", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].verdicts[].key", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].verdicts[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].verdicts[].tone", origin: "repository-authored" },












  { surface: "wire/intake-session", path: "columns[].header", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "columns[].normalizedHeader", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "columns[].samples[]", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "constants[].value", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "corrections[].correctedValue", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "exclusions[].reason", origin: "operator-authored" },
  { surface: "wire/intake-session", path: "headerCandidates[].cells[]", origin: "captured-hr-value" },

  { surface: "wire/intake-session", path: "manifest.validRows[].parsedInput", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "rerun.diff.added[].parsedInput", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "rerun.diff.changes[].now", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "rerun.diff.changes[].was", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "rerun.diff.removed[].parsedInput", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "sheet", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "sheets[]", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "sourceName", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "workbookSource.libraryId", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "targets[].label", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "validation.rejected[].column.header", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "validation.rejected[].issues[].code", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "validation.rejected[].issues[].message", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "validation.rejected[].issues[].path[]", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "validation.rejected[].path[]", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "validation.rejected[].reason", origin: "repository-authored" },


  { surface: "wire/diagnostic-bundle", path: "contents[].key", origin: "repository-authored" },
  { surface: "wire/diagnostic-bundle", path: "contents[].detail", origin: "repository-authored" },
  { surface: "wire/diagnostic-bundle", path: "contents[].mediaType", origin: "repository-authored" },
  { surface: "wire/diagnostic-bundle", path: "redaction.warnings[]", origin: "repository-authored" },

  { surface: "durable/failure-record", path: "debug.stack", origin: "external-text",
    exception: "Thrown Error stack is processed by failureDebugDetails in src/backend/runtime/execution/run-failure.ts using sanitizeDebugText before failure terminalization writes durable authority; credentials and regulated identifiers are removed." },
  { surface: "durable/failure-record", path: "debug.causes[]", origin: "external-text",
    exception: "Thrown cause messages are processed by failureDebugDetails in src/backend/runtime/execution/run-failure.ts using sanitizeDebugText before failure terminalization writes durable authority; credentials and regulated identifiers are removed." },
  { surface: "durable/failure-record", path: "causeChain[].summary", origin: "external-text",
    exception: "each cause's own thrown message, same reason as `summary` and dropped by the same advisory declaration." },
  { surface: "durable/failure-record", path: "page.titleRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "page.urlRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "remediation[].message", origin: "external-text",
    exception: "composed beside a closed `kind`, but it may quote the thrown message, so it is held to the untrusted class rather than assumed authored." },
  { surface: "durable/failure-record", path: "subject.expected.displayRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "subject.observed.displayRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "summary", origin: "external-text",
    exception: "ref operator-trust SS2.1 / D142: `error.message` verbatim is what tells the operator WHY, and the charter requires a thrown message to name the offending value. It is durable and operator-visible on purpose; the advisory drops it because that surface leaves the machine." },

  { surface: "durable/evidence-receipt", path: "decisions[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "input[].source.eventId", origin: "captured-hr-value" },
  { surface: "durable/evidence-receipt", path: "input[].source.sourceId", origin: "captured-hr-value" },
  { surface: "durable/evidence-receipt", path: "observations[].source.eventId", origin: "captured-hr-value" },
  { surface: "durable/evidence-receipt", path: "observations[].source.sourceId", origin: "captured-hr-value" },
  { surface: "durable/evidence-receipt", path: "output[].source.eventId", origin: "captured-hr-value" },
  { surface: "durable/evidence-receipt", path: "output[].source.sourceId", origin: "captured-hr-value" },
  { surface: "durable/evidence-receipt", path: "input[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "observations[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "output[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "warnings[].summary", origin: "external-text",
    exception: "src/backend/runs/provenance/evidence-receipt.ts copies `failure.summary` into the uncertainty warning; the receipt inherits the failure record's exception, not a second one." },

  { surface: "durable/notification-record", path: "summary", origin: "repository-authored" },
  { surface: "durable/notification-record", path: "title", origin: "repository-authored" },

  { surface: "durable/diagnostic-bundle", path: "redaction.warnings[]", origin: "repository-authored" },

  // The operator query is retained only in insert-only evidence; workbook cells exclude this possible identifier.
  { surface: "durable/run-search-index", path: "metadata.actor.value", origin: "captured-hr-value" },
  { surface: "durable/run-search-index", path: "metadata.subject.value", origin: "captured-hr-value" },
  { surface: "durable/run-search-gram", path: "token", origin: "captured-hr-value" },
  { surface: "durable/run-search-actor-link", path: "sourceId", origin: "repository-authored" },
  { surface: "durable/operator-xlsx-export", path: "download.contentDisposition", origin: "repository-authored" },
  { surface: "durable/operator-xlsx-export", path: "selection.query.q", origin: "captured-hr-value" },
  { surface: "durable/operator-xlsx-export", path: "selection.query.facets.subject", origin: "captured-hr-value" },
  { surface: "durable/operator-xlsx-export", path: "workbook.sheetNames[]", origin: "repository-authored" },

  { surface: "file/ledger-entry", path: "payload.idempotencyKey", origin: "captured-hr-value",
    exception: "the permanent key IS the external transaction's natural identity (ref write-safety SS3); a redacted key names no transaction and the dedupe fence could not be re-derived from it." },
  { surface: "file/ledger-entry", path: "payload.proof.value", origin: "captured-hr-value",
    exception: "the schema-bound proof the external system returned is the whole content of a filed-transaction record (ref write-safety SS6). A ledger of digests proves nothing was filed. It never leaves `.tracker/ledger/`." },


  { surface: "os/notification-projection", path: "summary", origin: "repository-authored" },
  { surface: "os/notification-projection", path: "title", origin: "repository-authored" },
  ]),
);

/* ── 7. module dispositions ───────────────────────────────────────────────── */

export const SURFACE_MODULE_DISPOSITIONS: readonly SurfaceModuleDisposition[] = Object.freeze(
  SurfaceModuleDispositionSchema.array().parse([
    { module: "src/models/profiles/public-profile.ts", state: "audited", reason: "Signup completion serves its existing local startup report and exact profile epoch only on loopback; detector summaries may name local storage basenames, never credentials or remote diagnostics." },
    { module: "src/models/dashboard/assistant.ts", state: "audited", reason: "Operator request and response stay on loopback: authored questions, reference-substituted answer text, confirmation proposals built from served plans, and the served chat history with its titles, drafts and display rows. Inference transport is a separate account boundary." },
    { module: "src/backend/assistant/service.ts", state: "audited", reason: "The process-egress leaves of the agent loop: the masked user message it sends to ChatGPT (decision D1) and the replayed answers and fixed captions of earlier turns (decision D3)." },
    ...ASSISTANT_PLUGIN_MODULES.map(module => ({ module, state: "audited" as const, reason: "Assistant tool outputs sent to ChatGPT; every free-text leaf is declared by the tool's privacy list and only repository-authored or declared-redacted origins pass." })),
    { module: "src/models/dashboard/chatgpt-account.ts", state: "audited", reason: "Local account identity and registered fixed failures only; OAuth start URL contains public PKCE, state and nonce, never tokens or verifier." },
    { module: "src/models/dashboard/assistant-usage.ts", state: "no-surface", reason: "Numeric token counts and closed unavailable reasons only; the assistant wire and debug event audit them where they ride." },
    { module: "src/models/dashboard/dashboard-frontend-owner.ts", state: "no-surface", reason: "Declares a closed launch nonce and probe pathname; no wire or durable free-text schema." },
    { module: "src/models/dashboard/failure-display.ts", state: "audited", reason: "Repository-authored failure title and observation are embedded in run detail and archived failure values." },
    { module: "src/models/dashboard/actions.ts", state: "audited", reason: "the action descriptor and its confirmation copy ride the queue row" },
    { module: "src/models/dashboard/run-decision.ts", state: "audited", reason: "Served run decisions carry catalog and workflow-declared option text, served action keys, candidate rows (names, last-4 EIDs, workbook cells) and the answer actor's profile name; loopback only." },
    { module: "src/models/dashboard/run-history.ts", state: "audited", reason: "Loopback request/status/result surfaces carry UUID command identity, nonnegative counts and closed states/refusals; no HR text or protected values." },
    { module: "src/models/dashboard/application-lifecycle.ts", state: "audited", reason: "the queue projection embeds only closed application/update states, runtime generation and opaque run/version targets; no free text or HR values" },
    { module: "src/models/dashboard/activity-population.ts", state: "audited", reason: "Loopback Analytics population, selected browse and CSV export retain captured run titles, operator-authored query text and nested report origins under exact snapshot identity." },
    { module: "src/models/dashboard/activity-volume.ts", state: "audited", reason: "the Activity report embeds validated host-zone boundaries calculated from selected dates" },
    { module: "src/models/dashboard/activity.ts", state: "audited", reason: "the activity report aggregates runs into counts and durations" },
    { module: "src/models/dashboard/artifacts.ts", state: "audited", reason: "artifact resources point at downloadable run output" },
    { module: "src/models/dashboard/bootstrap.ts", state: "audited", reason: "bootstrap carries the actor, the workflow registry and feature availability" },
    { module: "src/models/dashboard/diagnostic-bundle.ts", state: "audited", reason: "Diagnostic-bundle readback carries only verified attachment metadata and capture-time redaction facts" },
    { module: "src/models/dashboard/explorer.ts", state: "audited", reason: "the explorer projects descriptors, contracts and semantic UI task links" },
    { module: "src/models/dashboard/explorer-review-spec.ts", state: "audited", reason: "Embedded in the Explorer loopback surface; page, source, option and outcome text comes only from repository declarations and fictional examples." },
    { module: "src/models/dashboard/item-attempt-history.ts", state: "audited", reason: "the attempt-history wire serves retained per-item status and dates" },
    { module: "src/models/dashboard/native-path-picker.ts", state: "audited", reason: "the local native picker returns an operator-selected absolute pathname, never file contents" },
    { module: "src/models/dashboard/primitives.ts", state: "audited", reason: "shared wire primitives are carried by the surfaces that embed them" },
    { module: "src/models/dashboard/queue-parent.ts", state: "no-surface", reason: "Only opaque run identity and closed visibility; complete Queue text leaves are audited through projection.ts." },
    { module: "src/models/dashboard/projection.ts", state: "audited", reason: "the queue row and day projection are the operator's main surface" },
    { module: "src/models/dashboard/run-detail.ts", state: "audited", reason: "run detail and its sections carry everything one run touched" },
    { module: "src/models/dashboard/ucpath-findings.ts", state: "no-surface", reason: "Retained findings are audited through their containing run-detail section on operator loopback." },
    { module: "src/models/dashboard/calendar.ts", state: "audited", reason: "bounded dates, counts and generation only; no run or person data" },
    { module: "src/models/dashboard/activity-selection.ts", state: "audited", reason: "The served Activity report embeds a signed range/generation/digest token; strings are authored tokens only." },
    { module: "src/models/dashboard/search-calendar.ts", state: "audited", reason: "Pure local-day arithmetic with no new wire or stored values." },
    { module: "src/models/dashboard/search-export.ts", state: "audited", reason: "The request reuses the strict reviewed XLSX selection; diagnostic and CSV producers explicitly omit values and identifiers." },
    { module: "src/models/dashboard/search-index.ts", state: "audited", reason: "Private durable metadata, declared subject projection addresses, grams and authentic actor links; only approved public projection values are indexed." },
    { module: "src/models/dashboard/search.ts", state: "audited", reason: "cross-date search serves redacted run authority and an opaque continuation" },
    { module: "src/models/dashboard/settings.ts", state: "audited", reason: "the read-only Settings sections state configured system hosts and descriptor-derived capabilities" },
    { module: "src/models/dashboard/settings-catalog.ts", state: "audited", reason: "catalog-derived Settings controls and classifications are embedded by the audited editable Settings wire" },
    { module: "src/models/dashboard/settings-editor.ts", state: "audited", reason: "the server-listed editable Settings inventory carries strict values, provenance and runtime identity" },
    { module: "src/models/dashboard/status-vocabulary.ts", state: "audited", reason: "the closed status vocabulary is operator-visible prose and pill copy" },
    { module: "src/models/dashboard/storage.ts", state: "audited", reason: "the storage doctor reports on backups, files and health causes" },
    { module: "src/models/dashboard/subscription.ts", state: "audited", reason: "the stream envelope carries every live patch of the surfaces above" },
    { module: "src/models/dashboard/xlsx-export.ts", state: "audited", reason: "the XLSX evidence retains one exact redacted query or Activity snapshot and attachment identity" },
    { module: "src/models/dashboard/rerun-values.ts", state: "audited", reason: "the read-only Rerun response carries explicit descriptor coordinates and target-valid captured values; the reader withholds protected content and never grants repeat consent" },
    { module: "src/models/dashboard/rerun-warning.ts", state: "audited", reason: "Steps preview serves the same protected public Rerun plan as start-plan, without new input values or execution authority" },
    { module: "src/models/dashboard/start-plan.ts", state: "audited", reason: "the start-plan wire answers a plan with planned-row titles, match keys and refusal messages; the request and its omission facts never echo back" },
    { module: "src/models/dashboard/worker-command-result.ts", state: "audited", reason: "An actual worker command receipt (request and its audited result) is served only on operator loopback; nothing is retained beyond the command journal and audit." },
    { module: "src/models/dashboard/workbooks.ts", state: "audited", reason: "workbook values, source metadata and actual intake command receipts are served only on operator loopback and workbook revisions are retained in local authority" },
    { module: "src/models/dashboard/workbook-library.ts", state: "audited", reason: "the operator library serves retained workbook bytes and explicit version and source identities on loopback; named versions and action receipts remain in local authority" },
    { module: "src/models/dashboard/run-outputs.ts", state: "audited", reason: "workflow-authored output plans describe captured worksheet and person membership only to the local operator; the plan does not itself produce files" },
    { module: "src/models/intake/wire.ts", state: "audited", reason: "the mapping grid shows the operator their own uploaded file" },
    { module: "src/models/processing/workbooks/read-result.ts", state: "audited", reason: "A captured reference write names the library field and the cell value on operator loopback." },
    { module: "src/rules/runs/ledger.ts", state: "audited", reason: "the ledger entry is the permanent on-disk record of a filed transaction" },
    { module: "src/rules/notifications/notification-triggers.ts", state: "audited", reason: "the trigger event and its projection become OS-delivered text" },
    { module: "src/models/notifications/notifications.ts", state: "audited", reason: "the durable inbox row retains the delivered title and summary" },
    { module: "src/models/trust/diagnostic.ts", state: "audited", reason: "the diagnostic bundle row indexes captured attachments" },
    { module: "src/models/trust/evidence.ts", state: "audited", reason: "the evidence receipt is the durable answer to what a run read and wrote" },
    { module: "src/models/trust/failure.ts", state: "audited", reason: "the failure record is the durable answer to why a run stopped" },
  ]),
);

/* ── 8. the producer-side half of the `*Redacted` promise ─────────────────── */


export const RedactedProducerSiteSchema = z.strictObject({
  file: z.string().min(1),
  line: z.number().int().positive(),
  field: z.string().min(1),
  text: z.string().min(1),
});
export type RedactedProducerSite = z.infer<typeof RedactedProducerSiteSchema>;

const REDACTED_ASSIGNMENT = /(?:^|[\s{,(])([A-Za-z][A-Za-z0-9]*Redacted)\s*:/;
/** A zod declaration, a TypeScript member signature, or a type-only reference. */
const DECLARATION_HINT = /\bz\.|Schema\b|:\s*(?:string|number|boolean)\b/;

export function redactedProducerSites(root: string): readonly RedactedProducerSite[] {
  const sites: RedactedProducerSite[] = [];
  for (const file of walkFiles(root)) {
    const relativePath = repoRelative(file);
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [index, text] of lines.entries()) {
      const match = REDACTED_ASSIGNMENT.exec(text);
      const field = match?.[1];
      if (field === undefined) continue;
      if (DECLARATION_HINT.test(text)) continue;
      sites.push(RedactedProducerSiteSchema.parse({
        file: relativePath,
        line: index + 1,
        field,
        text: text.trim(),
      }));
    }
  }
  return Object.freeze(sites);
}

export function auditRedactedProducers(sites: readonly RedactedProducerSite[]): readonly string[] {
  return sites
    .filter(({ field }) => !WAIVED_REDACTED_FIELDS.has(field))
    .map(({ file, line, field, text }) => (
      `${file}:${String(line)} writes ${field} without a declared redaction; route the value through `
      + `redactValue under a declared classification, or waive the name in REDACTED_NAME_WAIVERS — ${text}`
    ));
}
