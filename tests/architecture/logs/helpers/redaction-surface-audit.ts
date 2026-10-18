import { ActivityPopulationSelectionSchema, ActivityPopulationSelectedReadSchema, ActivityPopulationExportSchema } from "../../../../src/models/dashboard/activity-population.js";
import { ChatGptAccountViewSchema, ChatGptSignInStartResultSchema, ChatGptSignInCompletionSchema, ChatGptCancelResultSchema, ChatGptSignOutResultSchema } from "../../../../src/models/dashboard/chatgpt-account.js";
import { EditableWorkbookSchema, SavedWorkbookSchema, EditableWorkbookWireSchema, SavedWorkbookWireSchema,
  WorkbookListWireSchema, WorkbookHistoryWireSchema, WorkbookCreateRequestSchema, WorkbookSaveRequestSchema,
  WorkbookIntakeRequestSchema, WorkbookIntakeResultSchema, IntakeCommandResultWireSchema } from "../../../../src/models/dashboard/workbooks.js";
import { CompositeStreamEnvelopeSchema } from "../../../../src/models/dashboard/run-logs-subscription.js";
import { OperationSourceResponseSchema } from "../../../../src/models/dashboard/operation-structure.js";
import { CalendarWireSchema } from "../../../../src/models/dashboard/calendar.js";
import { ExplorerOverrideImportReceiptSchema } from "../../../../src/models/dashboard/explorer-override.js";

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
import { NativePathPickerResponseSchema } from "../../../../src/models/dashboard/native-path-picker.js";
import { DiagnosticBundleWireSchema } from "../../../../src/models/dashboard/diagnostic-bundle.js";
import { ExplorerEditApplyResultSchema, ExplorerEditValidationResultSchema, ExplorerOverrideDocumentSchema, ExplorerWorkflowOverrideSchema, WorkflowExplorerWireSchema } from "../../../../src/models/dashboard/explorer.js";
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from "../../../../src/models/dashboard/projection.js";
import { RunDetailSectionResponseSchema, RunDetailWireSchema } from "../../../../src/models/dashboard/run-detail.js";
import { CrossDateSearchPageSchema } from "../../../../src/models/dashboard/search.js";
import { SettingsFactsWireSchema } from "../../../../src/models/dashboard/settings.js";
import { EditableSettingsPathSchema, EditableSettingsWireSchema } from "../../../../src/models/dashboard/settings-editor.js";
import { StorageDoctorWireSchema, StorageDoctorLatestWireSchema, ProtectedSettingsInspectionWireSchema } from "../../../../src/models/dashboard/storage.js";
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
      const rule = originRule(surface.egress, entry.origin);
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
    { surface: "protected-settings-readback", path: "entries.timekeeperName.present", valueClass: "closed-literal" },
    { surface: "protected-settings-readback", path: "entries.timekeeperName.updatedAt", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "entries.timekeeperName.valueId", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "entries.sharepointOnboardingRosterUrl.present", valueClass: "closed-literal" },
    { surface: "protected-settings-readback", path: "entries.sharepointOnboardingRosterUrl.updatedAt", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "entries.sharepointOnboardingRosterUrl.valueId", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "entries.activityPersonPseudonym.present", valueClass: "closed-literal" },
    { surface: "protected-settings-readback", path: "entries.activityPersonPseudonym.updatedAt", valueClass: "identifier-free" },
    { surface: "protected-settings-readback", path: "entries.activityPersonPseudonym.valueId", valueClass: "identifier-free" },
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
  "src/models/intake/wire.ts",
  "src/rules/runs/ledger.ts",
  "src/rules/notifications/notification-triggers.ts",
  "src/models/notifications/notifications.ts",
  "src/models/trust/diagnostic.ts",
  "src/models/trust/evidence.ts",
  "src/models/trust/failure.ts",
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
  ssn: "917-90-1546",
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
  { id: "wire/workbook-history", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookHistoryWireSchema },
  { id: "request/workbook-create", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookCreateRequestSchema },
  { id: "request/workbook-save", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookSaveRequestSchema },
  { id: "request/workbook-intake", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookIntakeRequestSchema },
  { id: "wire/workbook-intake", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: WorkbookIntakeResultSchema },
  { id: "wire/intake-command-result", egress: "operator-loopback", module: "src/models/dashboard/workbooks.ts", schema: IntakeCommandResultWireSchema },

  { id: "wire/run-logs-stream", egress: "operator-loopback", module: "src/models/dashboard/run-logs-subscription.ts", schema: CompositeStreamEnvelopeSchema },
  { id: "wire/rerun-values", egress: "operator-loopback", module: "src/models/dashboard/rerun-values.ts", schema: RerunValuesResponseSchema },
  { id: "wire/rerun-warning", egress: "operator-loopback", module: "src/models/dashboard/rerun-warning.ts", schema: RerunWarningWireSchema },
  { id: "wire/run-detail", egress: "operator-loopback", module: "src/models/dashboard/run-detail.ts", schema: RunDetailWireSchema },
  { id: "wire/operation-source", egress: "operator-loopback", module: "src/models/dashboard/operation-structure.ts", schema: OperationSourceResponseSchema },
  { id: "wire/run-detail-section", egress: "operator-loopback", module: "src/models/dashboard/run-detail.ts", schema: RunDetailSectionResponseSchema },
  { id: "wire/queue-surface", egress: "operator-loopback", module: "src/models/dashboard/projection.ts", schema: QueueSurfaceWireSchema },
  { id: "wire/dashboard-day", egress: "operator-loopback", module: "src/models/dashboard/projection.ts", schema: DashboardDayWireSchema },
  { id: "wire/stream-envelope", egress: "operator-loopback", module: "src/models/dashboard/subscription.ts", schema: DashboardStreamEnvelopeSchema },
  { id: "wire/bootstrap", egress: "operator-loopback", module: "src/models/dashboard/bootstrap.ts", schema: FrontendBootstrapWireSchema },
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
  { id: "wire/storage-doctor-latest", egress: "operator-loopback", module: "src/models/dashboard/storage.ts", schema: StorageDoctorLatestWireSchema },
  { id: "wire/settings-facts", egress: "operator-loopback", module: "src/models/dashboard/settings.ts", schema: SettingsFactsWireSchema },
  { id: "wire/editable-settings", egress: "operator-loopback", module: "src/models/dashboard/settings-editor.ts", schema: EditableSettingsWireSchema },
  { id: "wire/chatgpt-account", egress: "operator-loopback", module: "src/models/dashboard/chatgpt-account.ts", schema: ChatGptAccountViewSchema },
  { id: "wire/chatgpt-start", egress: "operator-loopback", module: "src/models/dashboard/chatgpt-account.ts", schema: ChatGptSignInStartResultSchema },
  { id: "wire/chatgpt-completion", egress: "operator-loopback", module: "src/models/dashboard/chatgpt-account.ts", schema: ChatGptSignInCompletionSchema },
  { id: "wire/chatgpt-cancel", egress: "operator-loopback", module: "src/models/dashboard/chatgpt-account.ts", schema: ChatGptCancelResultSchema },
  { id: "wire/chatgpt-signout", egress: "operator-loopback", module: "src/models/dashboard/chatgpt-account.ts", schema: ChatGptSignOutResultSchema },
  { id: "wire/native-path-picker", egress: "operator-loopback", module: "src/models/dashboard/native-path-picker.ts", schema: NativePathPickerResponseSchema },
  { id: "wire/workflow-explorer", egress: "operator-loopback", module: "src/models/dashboard/explorer.ts", schema: WorkflowExplorerWireSchema },
  { id: "wire/explorer-edit-validation", egress: "operator-loopback", module: "src/models/dashboard/explorer.ts", schema: ExplorerEditValidationResultSchema },
  { id: "wire/explorer-edit-apply", egress: "operator-loopback", module: "src/models/dashboard/explorer.ts", schema: ExplorerEditApplyResultSchema },
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
  { id: "durable/explorer-overrides", egress: "durable-authority", module: "src/models/dashboard/explorer.ts", schema: ExplorerWorkflowOverrideSchema },
  { id: "durable/explorer-import-receipt", egress: "durable-authority", module: "src/models/dashboard/explorer-override.ts", schema: ExplorerOverrideImportReceiptSchema },

  { id: "file/explorer-overrides", egress: "durable-file", module: "src/models/dashboard/explorer.ts", schema: ExplorerOverrideDocumentSchema },
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
  { path: "sheets[].rows[].id", origin: "captured-hr-value" },
  { path: "themes", origin: "captured-hr-value" },
  { path: "themes[]", origin: "captured-hr-value" },
];

export const SURFACE_LEAF_ORIGINS: readonly SurfaceLeafOrigin[] = Object.freeze(
  SurfaceLeafOriginSchema.array().parse([
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.actions[].confirm.body", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.actions[].confirm.confirmLabel", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.actions[].confirm.title", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.actions[].detail", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.actions[].key", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.actions[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.actions[].navigate.runId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.appVersion.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.displayName.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.displayName.value", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.endedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.facts.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.facts.value[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.facts.value[].value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.gateOpenedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.linkedRuns[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.liveMessage.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.liveMessage.value", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.memberPreview.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.memberPreview.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.outcome.label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.pipeline[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.runNumber.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.session.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.subtitle.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.subtitle.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.title", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.warnings.first", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.attemptHistory[].surface.warnings.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.note.operatorAction.label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.note.operatorAction.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.notes[].operatorAction.label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.notes[].operatorAction.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.rows[].displayFields[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.rows[].displayFields[].value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.rows[].note.operatorAction.label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.rows[].note.operatorAction.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-detail-section", "path": "payload.notes[].operatorAction.label", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.notes[].operatorAction.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-detail-section", "path": "payload.observations[].displayFields[].label", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.observations[].displayFields[].value", "origin": "captured-hr-value"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].displayFields[].label", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].displayFields[].value", "origin": "captured-hr-value"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].note.operatorAction.label", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].note.operatorAction.value", "origin": "captured-hr-value"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.actions[].confirm.body", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.actions[].confirm.confirmLabel", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.actions[].confirm.title", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.actions[].detail", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.actions[].key", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.actions[].label", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.actions[].navigate.runId", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.appVersion.reason", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.displayName.reason", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.displayName.value", "origin": "external-text"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.endedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.facts.reason", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.facts.value[].label", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.facts.value[].value", "origin": "captured-hr-value"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.gateOpenedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.linkedRuns[].label", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.liveMessage.reason", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.liveMessage.value", "origin": "external-text"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.memberPreview.reason", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.memberPreview.value", "origin": "captured-hr-value"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.outcome.label", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.pipeline[].label", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.runNumber.reason", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.session.reason", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.subtitle.reason", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.subtitle.value", "origin": "captured-hr-value"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.title", "origin": "captured-hr-value"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.warnings.first", "origin": "external-text"},
  {"surface": "wire/dashboard-day", "path": "attemptHistory[].surface.warnings.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.actions[].confirm.body", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.actions[].confirm.confirmLabel", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.actions[].confirm.title", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.actions[].detail", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.actions[].key", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.actions[].label", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.actions[].navigate.runId", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.appVersion.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.displayName.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.displayName.value", "origin": "external-text"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.endedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.facts.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.facts.value[].label", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.facts.value[].value", "origin": "captured-hr-value"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.gateOpenedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.linkedRuns[].label", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.liveMessage.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.liveMessage.value", "origin": "external-text"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.memberPreview.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.memberPreview.value", "origin": "captured-hr-value"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.outcome.label", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.pipeline[].label", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.runNumber.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.session.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.subtitle.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.subtitle.value", "origin": "captured-hr-value"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.title", "origin": "captured-hr-value"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.warnings.first", "origin": "external-text"},
  {"surface": "wire/stream-envelope", "path": "payload.attemptHistory[].surface.warnings.reason", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.note.operatorAction.label", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.note.operatorAction.value", "origin": "captured-hr-value"},
  {"surface": "wire/stream-envelope", "path": "payload.notes[].operatorAction.label", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.notes[].operatorAction.value", "origin": "captured-hr-value"},
  {"surface": "wire/stream-envelope", "path": "payload.rows[].displayFields[].label", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.rows[].displayFields[].value", "origin": "captured-hr-value"},
  {"surface": "wire/stream-envelope", "path": "payload.rows[].note.operatorAction.label", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.rows[].note.operatorAction.value", "origin": "captured-hr-value"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].definitionPreview.groups[].description", "origin": "repository-authored"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].definitionPreview.groups[].operatorFields[].example", "origin": "repository-authored"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].definitionPreview.groups[].operatorFields[].label", "origin": "repository-authored"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].timeline[].description", "origin": "repository-authored"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].timeline[].operatorFields[].example", "origin": "repository-authored"},
  {"surface": "wire/workflow-explorer", "path": "workflows[].timeline[].operatorFields[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.confirmedActionBindings[].eventId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.confirmedActionBindings[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.note.native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.notes[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.timeline.events[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.rows[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.rows[].note.native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.timeline.events[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail", "path": "timeline.events[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.confirmedActionBindings[].eventId", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.confirmedActionBindings[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.notes[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.observations[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.rows[].note.native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-detail-section", "path": "payload.value.native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.confirmedActionBindings[].eventId", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.confirmedActionBindings[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.note.native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.notes[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.replacement.timeline.events[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.rows[].native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.rows[].note.native.spanPath", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.timeline.events[].native.spanPath", "origin": "repository-authored"},
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
  { surface: "wire/run-logs-stream", path: "envelope.publication.notification.context.subject", origin: "captured-hr-value" },
  { surface: "wire/run-logs-stream", path: "envelope.publication.notification.context.workflow", origin: "repository-authored" },
  { surface: "wire/run-logs-stream", path: "envelope.publication.notification.summary", origin: "repository-authored" },
  { surface: "wire/run-logs-stream", path: "envelope.publication.notification.title", origin: "repository-authored" },
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
  { surface: "wire/workbook-intake", path: "code", origin: "repository-authored" },
  { surface: "wire/workbook-intake", path: "message", origin: "captured-hr-value" },
  { surface: "wire/intake-command-result", path: "request.payload.correctedValue", origin: "captured-hr-value" },
  { surface: "wire/intake-command-result", path: "request.payload.reason", origin: "operator-authored" },
  { surface: "wire/intake-command-result", path: "request.payload.sheet", origin: "captured-hr-value" },
  { surface: "wire/intake-command-result", path: "request.reason", origin: "operator-authored" },
  { surface: "wire/intake-command-result", path: "result.entries", origin: "protected-value" },
  { surface: "wire/intake-command-result", path: "result.message", origin: "captured-hr-value" },

  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerAuthority.reason", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerOperations[].phase.application.result.entries", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerOperations[].phase.application.result.message", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerOperations[].phase.message", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerOperations[].request.reason", "origin": "operator-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerOperations[].scope", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "workerAuthority.reason", "origin": "external-text"},
  {"surface": "wire/dashboard-day", "path": "workerOperations[].phase.application.result.entries", "origin": "repository-authored"},
  {"surface": "wire/dashboard-day", "path": "workerOperations[].phase.application.result.message", "origin": "external-text"},
  {"surface": "wire/dashboard-day", "path": "workerOperations[].phase.message", "origin": "external-text"},
  {"surface": "wire/dashboard-day", "path": "workerOperations[].request.reason", "origin": "operator-authored"},
  {"surface": "wire/dashboard-day", "path": "workerOperations[].scope", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.workerAuthority.reason", "origin": "external-text"},
  {"surface": "wire/stream-envelope", "path": "payload.workerOperations[].phase.application.result.entries", "origin": "repository-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.workerOperations[].phase.application.result.message", "origin": "external-text"},
  {"surface": "wire/stream-envelope", "path": "payload.workerOperations[].phase.message", "origin": "external-text"},
  {"surface": "wire/stream-envelope", "path": "payload.workerOperations[].request.reason", "origin": "operator-authored"},
  {"surface": "wire/stream-envelope", "path": "payload.workerOperations[].scope", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.captures.message", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.captures.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.confirmedActions[].action.value.consumed.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.confirmedActions[].durableProof.checkpointNodeId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.confirmedActions[].durableProof.writeIntentId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.confirmedActions[].eventId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.confirmedActions[].proof.verifier.value.consumed.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.confirmedActions[].reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.confirmedActions[].stepOccurrence", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.confirmedActions[].workerStreamId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.gate.label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.gate.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.header.title", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.members[].label", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.message", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.note.fields[].key", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.note.fields[].value", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.note.message", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.notes[].fields[].key", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.notes[].fields[].value", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.notes[].message", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.notifications[].context.subject", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.notifications[].context.workflow", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.notifications[].summary", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.notifications[].title", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.operationStructure.definition.invocations[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.operationStructure.definition.invocations[].operation.actions[]", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.operationStructure.definition.invocations[].operation.templates[].join.separator", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.operationStructure.definition.invocations[].operation.templates[].segments[]", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.operationStructure.definition.invocations[].outcomes[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.operationStructure.definition.presentation[]", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.operationStructure.observations[].occurrence.value.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.operationStructure.observations[].occurrence.value.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.operationStructure.observations[].targetId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.operationStructure.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.outcome.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].actions[].confirm.body", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].actions[].confirm.confirmLabel", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].actions[].confirm.title", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].actions[].detail", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].actions[].key", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].actions[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].actions[].navigate.runId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].appVersion.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].displayName.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].displayName.value", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].endedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].facts.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].facts.value[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].facts.value[].value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].gateOpenedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].linkedRuns[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].liveMessage.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].liveMessage.value", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].memberPreview.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].memberPreview.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].outcome.label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].pipeline[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].runNumber.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].session.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].subtitle.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].subtitle.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].title", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].warnings.first", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.queueSurfaces[].warnings.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.records[].label", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.actions[].confirm.body", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.actions[].confirm.confirmLabel", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.actions[].confirm.title", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.actions[].detail", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.actions[].key", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.actions[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.actions[].navigate.runId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.appVersion.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.captures.message", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.captures.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.displayName.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.displayName.value", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.endedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.facts.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.facts.value[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.facts.value[].value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.gate.label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.gate.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.gateOpenedAt.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.header.title", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.label", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.linkedRuns[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.liveMessage.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.liveMessage.value", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.memberPreview.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.memberPreview.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.message", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.outcome.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.outcome.label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.pipeline[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.runNumber.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.session.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.subtitle.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.subtitle.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.timeline.events[].durationMs.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.timeline.events[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.timeline.events[].notRun.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.timeline.steps[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.timeline.steps[].members[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.title", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.warnings.first", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.replacement.warnings.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.rows[].note.fields[].key", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.rows[].note.fields[].value", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.rows[].note.message", "origin": "external-text"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.rows[].producer.step", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.rows[].spanPath", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.timeline.events[].durationMs.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.timeline.events[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.timeline.events[].notRun.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.timeline.steps[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.timeline.steps[].members[].label", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerCards[].browserRequirements.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerCards[].browsers[].observation.instance", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerCards[].browsers[].observation.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerCards[].controls.basis.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerCards[].controls.operation.message", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerCards[].controls.ownership.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "envelope.payload.workerCards[].currentRun.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "event.action.value.consumed.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "event.durableProof.checkpointNodeId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "event.durableProof.writeIntentId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "event.eventId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "event.proof.verifier.value.consumed.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "event.reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "event.stepOccurrence", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "event.workerStreamId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "snapshot.events[].action.value.consumed.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "snapshot.events[].durableProof.checkpointNodeId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "snapshot.events[].durableProof.writeIntentId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "snapshot.events[].eventId", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "snapshot.events[].proof.verifier.value.consumed.value", "origin": "captured-hr-value"},
  {"surface": "wire/run-logs-stream", "path": "snapshot.events[].reason", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "snapshot.events[].stepOccurrence", "origin": "repository-authored"},
  {"surface": "wire/run-logs-stream", "path": "snapshot.events[].workerStreamId", "origin": "repository-authored"},
  { surface: "wire/chatgpt-account", path: "account.message", origin: "repository-authored" },
  { surface: "wire/chatgpt-account", path: "account.name", origin: "external-text" },
  { surface: "wire/chatgpt-account", path: "message", origin: "repository-authored" },
  { surface: "wire/chatgpt-account", path: "name", origin: "external-text" },
  { surface: "wire/chatgpt-start", path: "message", origin: "repository-authored" },
  { surface: "wire/chatgpt-completion", path: "account.message", origin: "repository-authored" },
  { surface: "wire/chatgpt-completion", path: "account.name", origin: "external-text" },
  { surface: "wire/chatgpt-completion", path: "message", origin: "repository-authored" },
  { surface: "wire/chatgpt-cancel", path: "message", origin: "repository-authored" },
  { surface: "wire/chatgpt-signout", path: "message", origin: "repository-authored" },
  { surface: "wire/operation-source", path: "structure.definition.invocations[].label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.confirmedActions[].action.value.consumed.value", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.confirmedActions[].durableProof.checkpointNodeId", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.confirmedActions[].durableProof.writeIntentId", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.confirmedActions[].eventId", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.confirmedActions[].proof.verifier.value.consumed.value", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.confirmedActions[].reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.confirmedActions[].stepOccurrence", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.confirmedActions[].workerStreamId", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.operationStructure.definition.invocations[].label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.display.observation", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.display.title", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "notifications[].context.subject", origin: "captured-hr-value" },
  { surface: "wire/dashboard-day", path: "notifications[].context.workflow", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.confirmedActions[].action.value.consumed.value", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.confirmedActions[].durableProof.checkpointNodeId", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.confirmedActions[].durableProof.writeIntentId", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.confirmedActions[].eventId", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.confirmedActions[].proof.verifier.value.consumed.value", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.confirmedActions[].reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.confirmedActions[].stepOccurrence", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.confirmedActions[].workerStreamId", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.notifications[].context.subject", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.notifications[].context.workflow", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.operationStructure.definition.invocations[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].definitionPreview.groups[].key", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].definitionPreview.groups[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].definitionPreview.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].operationStructure.definition.invocations[].label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.operationStructure.observations[].occurrence.value.value", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.operationStructure.observations[].occurrence.value.value", origin: "captured-hr-value" },
  { surface: "wire/operation-source", path: "structure.definition.invocations[].operation.actions[]", origin: "repository-authored" },
  { surface: "wire/operation-source", path: "structure.definition.invocations[].operation.templates[].join.separator", origin: "repository-authored" },
  { surface: "wire/operation-source", path: "structure.definition.invocations[].operation.templates[].segments[]", origin: "repository-authored" },
  { surface: "wire/operation-source", path: "structure.definition.invocations[].outcomes[].label", origin: "repository-authored" },
  { surface: "wire/operation-source", path: "structure.definition.presentation[]", origin: "repository-authored" },
  { surface: "wire/operation-source", path: "structure.observations[].targetId", origin: "repository-authored" },
  { surface: "wire/operation-source", path: "structure.observations[].occurrence.value.reason", origin: "repository-authored" },
  { surface: "wire/operation-source", path: "structure.observations[].occurrence.value.value", origin: "captured-hr-value" },
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
  { surface: "wire/editable-settings", path: "protectedSettings.entries.timekeeperName.value", origin: "protected-value" },
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
  { surface: "wire/run-detail-section", path: "payload.operationStructure.definition.invocations[].operation.actions[]", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.operationStructure.definition.invocations[].operation.templates[].join.separator", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.operationStructure.definition.invocations[].operation.templates[].segments[]", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.operationStructure.definition.invocations[].outcomes[].label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.operationStructure.definition.presentation[]", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.operationStructure.observations[].targetId", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.operationStructure.observations[].occurrence.value.reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.operationStructure.reason", origin: "repository-authored" },
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

  { surface: "wire/stream-envelope", path: "payload.operationStructure.definition.invocations[].operation.actions[]", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.operationStructure.definition.invocations[].operation.templates[].join.separator", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.operationStructure.definition.invocations[].operation.templates[].segments[]", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.operationStructure.definition.invocations[].outcomes[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.operationStructure.definition.presentation[]", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.operationStructure.observations[].targetId", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.operationStructure.observations[].occurrence.value.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.operationStructure.reason", origin: "repository-authored" },

  { surface: "wire/workflow-explorer", path: "workflows[].operationStructure.definition.invocations[].operation.actions[]", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].operationStructure.definition.invocations[].operation.templates[].join.separator", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].operationStructure.definition.invocations[].operation.templates[].segments[]", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].operationStructure.definition.invocations[].outcomes[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].operationStructure.definition.presentation[]", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].operationStructure.reason", origin: "repository-authored" },



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
  { surface: "wire/run-detail-section", path: "payload.value.packet.documentNumber", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.documentName", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.documentEidText", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.ucpathName", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.comparisons[].documentValue", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.comparisons[].ucpathValue", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.comparisons[].note", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.nameSearch.candidate.name", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.nameSearch.candidate.department", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.nameSearch.candidate.jobTitle", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.jobs.rows[].emplRecord", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.jobs.rows[].hrStatus", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.jobs.rows[].department", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.jobs.rows[].jobTitle", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.jobs.rows[].effectiveDate", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.jobs.unreadableCells[]", origin: "repository-authored" },

  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.termination.terminationType", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.termination.template", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.termination.reasonCode", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.termination.emplRecord", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.termination.effectiveDate", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.termination.lastDateWorked", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.termination.initiatorComments", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.document.documentNumber", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.document.department", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.document.departmentCode", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.document.ucpathDepartment", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.document.payrollTitleCode", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.document.payrollTitle", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.document.terminationEffectiveDate", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.dates.kualiLastDayWorked", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.dates.lastDayWorked", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.dates.kualiSeparationDate", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.dates.separationDate", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.dates.unclassifiedPayCodes[]", origin: "captured-hr-value" },

  { surface: "wire/queue-surface", path: "appVersion.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "endedAt.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "gateOpenedAt.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "displayName.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "displayName.value", origin: "external-text" },
  { surface: "wire/queue-surface", path: "liveMessage.reason", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "liveMessage.value", origin: "external-text" },
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
  { surface: "wire/dashboard-day", path: "workerCards[].browserRequirements.reason", origin: "repository-authored" },
  // Sessions: projector-authored reasons, parsed prod/test instance, and bounded worker-control outcomes.
  { surface: "wire/dashboard-day", path: "workerCards[].browsers[].observation.instance", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "workerCards[].browsers[].observation.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "workerCards[].controls.basis.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "workerCards[].controls.operation.message", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "workerCards[].controls.ownership.reason", origin: "repository-authored" },


  { surface: "wire/stream-envelope", path: "payload.gate.label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.timeline.events[].durationMs.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.timeline.steps[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.timeline.steps[].members[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.timeline.events[].durationMs.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.timeline.steps[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.timeline.steps[].members[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.gate.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.header.title", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.members[].label", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.message", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.note.message", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.note.fields[].key", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.note.fields[].value", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.notes[].message", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.notes[].fields[].key", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.notes[].fields[].value", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.rows[].note.message", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.rows[].note.fields[].key", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.rows[].note.fields[].value", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.rows[].producer.step", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.rows[].spanPath", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.notifications[].summary", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.notifications[].title", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.outcome.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].appVersion.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].endedAt.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].gateOpenedAt.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].displayName.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].displayName.value", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].liveMessage.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].liveMessage.value", origin: "external-text" },
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
  { surface: "wire/stream-envelope", path: "payload.records[].label", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.replacement.appVersion.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.endedAt.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.gate.label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.gate.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.gateOpenedAt.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.header.title", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.replacement.label", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.replacement.displayName.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.displayName.value", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.replacement.liveMessage.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.liveMessage.value", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.replacement.message", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.outcome.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.outcome.label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.pipeline[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.subtitle.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.subtitle.value", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.replacement.timeline.events[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.timeline.events[].notRun.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.warnings.first", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.replacement.warnings.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.title", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.timeline.events[].label", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.timeline.events[].notRun.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].currentRun.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].browserRequirements.reason", origin: "repository-authored" },
  // Sessions: projector-authored reasons, parsed prod/test instance, and bounded worker-control outcomes.
  { surface: "wire/stream-envelope", path: "payload.workerCards[].browsers[].observation.instance", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].browsers[].observation.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].controls.basis.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].controls.operation.message", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.workerCards[].controls.ownership.reason", origin: "repository-authored" },

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

  { surface: "wire/bootstrap", path: "actor.label", origin: "repository-authored" },
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
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.placeholder", origin: "repository-authored" },
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
  { surface: "wire/workflow-explorer", path: "workflows[].edit.editData.fields[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].edit.editData.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].edit.notificationPreferences.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].edit.operationalPolicies.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].edit.presentation.timeline.reason", origin: "repository-authored" },
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

  { surface: "wire/explorer-edit-validation", path: "brief.failedObligations[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.reason", origin: "repository-authored" },

  { surface: "wire/explorer-edit-validation", path: "brief.baseAttestation.checks.graph.coveragePointIds[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.patch.canonicalDescriptorJson", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.patch.changes[].fields[].label", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.patch.typescript.operations[].afterExpression", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.patch.typescript.operations[].beforeExpression", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.requiredChecks[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.edges.added[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.edges.changed[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.edges.removed[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.effects.added[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.effects.removed[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.evidenceObligations[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.policies[].after", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.policies[].before", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.policies[].path", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.presentation[].after", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.presentation[].before", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.presentation[].path", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.uiIds.added[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "brief.semanticDiff.uiIds.removed[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "category", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "compileAttestation.checks.graph.coveragePointIds[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "draft.changes[].fields[].label", origin: "operator-authored" },
  { surface: "wire/explorer-edit-validation", path: "draft.changes[].value", origin: "operator-authored" },
  { surface: "wire/explorer-edit-validation", path: "message", origin: "repository-authored" },
  { surface: "wire/explorer-edit-validation", path: "override.presentation.label", origin: "operator-authored" },
  { surface: "wire/explorer-edit-validation", path: "semanticDiff[].after", origin: "operator-authored" },
  { surface: "wire/explorer-edit-validation", path: "semanticDiff[].before", origin: "operator-authored" },
  { surface: "wire/explorer-edit-validation", path: "semanticDiff[].path", origin: "repository-authored" },

  { surface: "wire/explorer-edit-apply", path: "brief.failedObligations[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.reason", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.baseAttestation.checks.graph.coveragePointIds[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.patch.canonicalDescriptorJson", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.patch.changes[].fields[].label", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.patch.typescript.operations[].afterExpression", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.patch.typescript.operations[].beforeExpression", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.requiredChecks[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.edges.added[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.edges.changed[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.edges.removed[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.effects.added[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.effects.removed[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.evidenceObligations[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.policies[].after", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.policies[].before", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.policies[].path", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.presentation[].after", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.presentation[].before", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.presentation[].path", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.uiIds.added[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "brief.semanticDiff.uiIds.removed[]", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "category", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "message", origin: "repository-authored" },
  { surface: "wire/explorer-edit-apply", path: "override.presentation.label", origin: "operator-authored" },
  { surface: "wire/explorer-edit-apply", path: "readback.presentation.label", origin: "operator-authored" },

  { surface: "durable/explorer-overrides", path: "presentation.label", origin: "operator-authored", exception: "D337 / ref operator-trust §5.4 preserves the operator-authored label in SQLite; ExplorerPresentationLabelSchema rejects credential and regulated-value shapes before persistence." },
  { surface: "durable/explorer-import-receipt", path: "source.document.workflows[].presentation.label", origin: "operator-authored", exception: "D337 / ref operator-trust §5.4 requires a durable source receipt for stopped conversion; it embeds only the same strict presentation label accepted by the existing safe-edit schema." },
  { surface: "file/explorer-overrides", path: "workflows[].presentation.label", origin: "operator-authored" },





  { surface: "wire/stream-envelope", path: "payload.captures.message", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.captures.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.captures.message", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.captures.reason", origin: "repository-authored" },



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
  { surface: "durable/run-search-declaration", path: "subjectProjection.nodeId", origin: "repository-authored" },
  { surface: "durable/run-search-declaration", path: "subjectProjection.fieldPath", origin: "repository-authored" },
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
    { module: "src/models/dashboard/chatgpt-account.ts", state: "audited", reason: "Local account identity and registered fixed failures only; OAuth start URL contains public PKCE, state and nonce, never tokens or verifier." },
    { module: "src/models/dashboard/dashboard-frontend-owner.ts", state: "no-surface", reason: "Declares a closed launch nonce and probe pathname; no wire or durable free-text schema." },
    { module: "src/models/dashboard/failure-display.ts", state: "audited", reason: "Repository-authored failure title and observation are embedded in run detail and archived failure values." },
    { module: "src/models/dashboard/run-logs-subscription.ts", state: "audited", reason: "Composite loopback stream embeds the dashboard envelope and confirmed action events with exact run and transport identities." },
    { module: "src/models/dashboard/actions.ts", state: "audited", reason: "the action descriptor and its confirmation copy ride the queue row" },
    { module: "src/models/dashboard/activity-population.ts", state: "audited", reason: "Loopback Analytics population, selected browse and CSV export retain captured run titles, operator-authored query text and nested report origins under exact snapshot identity." },
    { module: "src/models/dashboard/activity-volume.ts", state: "audited", reason: "the Activity report embeds validated host-zone boundaries calculated from selected dates" },
    { module: "src/models/dashboard/activity.ts", state: "audited", reason: "the activity report aggregates runs into counts and durations" },
    { module: "src/models/dashboard/artifacts.ts", state: "audited", reason: "artifact resources point at downloadable run output" },
    { module: "src/models/dashboard/bootstrap.ts", state: "audited", reason: "bootstrap carries the actor, the workflow registry and feature availability" },
    { module: "src/models/dashboard/diagnostic-bundle.ts", state: "audited", reason: "Diagnostic-bundle readback carries only verified attachment metadata and capture-time redaction facts" },
    { module: "src/models/dashboard/explorer-edit.ts", state: "audited", reason: "DCC4 schema declarations remain only as source ancestry; no integrated durable surface or active runtime repository uses them" },
    { module: "src/models/dashboard/explorer-override.ts", state: "audited", reason: "Transaction ports use the existing strict override values; the durable stopped-import receipt retains only that safe presentation document and source/backup digests" },
    { module: "src/models/dashboard/explorer.ts", state: "audited", reason: "the explorer projects descriptors, contracts and semantic UI task links" },
    { module: "src/models/dashboard/operation-structure.ts", state: "audited", reason: "shared Explorer and Logs structure carries only canonical frozen declarations and already-redacted action provenance" },
    { module: "src/models/dashboard/item-attempt-history.ts", state: "audited", reason: "the attempt-history wire serves retained per-item status and dates" },
    { module: "src/models/dashboard/native-path-picker.ts", state: "audited", reason: "the local native picker returns an operator-selected absolute pathname, never file contents" },
    { module: "src/models/dashboard/primitives.ts", state: "audited", reason: "shared wire primitives are carried by the surfaces that embed them" },
    { module: "src/models/dashboard/projection.ts", state: "audited", reason: "the queue row and day projection are the operator's main surface" },
    { module: "src/models/dashboard/run-detail.ts", state: "audited", reason: "run detail and its sections carry everything one run touched" },
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
    { module: "src/models/dashboard/workbooks.ts", state: "audited", reason: "workbook values, source metadata and actual intake command receipts are served only on operator loopback and workbook revisions are retained in local authority" },
    { module: "src/models/intake/wire.ts", state: "audited", reason: "the mapping grid shows the operator their own uploaded file" },
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
