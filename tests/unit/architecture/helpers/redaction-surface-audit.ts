/**
 * Ref guards-and-tests §3.15 / D183 — the redaction surface scan's declaration half.
 *
 * `src/domain/redaction.ts` owns the ONE transform implementation and three
 * tables declare `(classification, transform)` per field:
 * `src/domain/trust/evidence-classification.ts` (the receipt),
 * `src/domain/trust/advisory.ts` (the prompt that LEAVES the process) and
 * `src/domain/fields/registry.ts` (canonical intake fields). What none of them
 * answered until D183 is the question this module exists to force:
 *
 *   **for every value that reaches a wire, a durable file, a notification or a
 *   provider — where did that string come from?**
 *
 * A redacted value is self-describing (it carries its own classification and
 * transform), and a closed vocabulary, a branded id, a count or an instant
 * cannot hold a person's data. Everything else is a free-text or open-JSON
 * leaf, and every one of those must be DISPOSITIONED here with a declared
 * origin. The audit is driven off the schema itself — `z.toJSONSchema` over the
 * registered surface — so a field ADDED to a wire schema appears as a new
 * undispositioned leaf and the guard goes red. That is the whole point: a guard
 * that only knows today's fields is a guard that cannot fail tomorrow.
 *
 * ## The origins
 *
 * They are ordered by how much this repository controls the bytes:
 *
 * - `repository-authored` — composed inside `src/` from string literals, closed
 *   vocabularies, branded ids and numbers. It cannot carry a value captured
 *   from an external system or typed by a person.
 * - `operator-authored` — typed by the local operator into a strict schema
 *   that rejects credential/regulated-value shapes before durable storage.
 * - `declared-redacted` — the value went through `redactValue` under a declared
 *   `(classification, transform)` pair, or is a `*Redacted`-suffixed scalar
 *   whose producer applies a bounded projection before it is stored.
 * - `local-filesystem-name` — the name of a file this repository itself created.
 * - `captured-hr-value` — read from an external HR system, or from the
 *   operator's own uploaded file, and shown deliberately.
 * - `external-text` — free text authored OUTSIDE this repository and copied
 *   verbatim: a thrown error's `message`, a page title, a provider's answer.
 *   Nobody here controls what it contains, which is why it is the class that
 *   needs an explicit exception the moment it becomes durable or leaves.
 *
 * ## The egress classes, and why the matrix is shaped the way it is
 *
 * `operator-loopback` is the dashboard bound to `127.0.0.1` (ref clock-config-secrets §6.1) and
 * read by the single operator who is authorized to see this data — so every
 * origin is admissible there and the teeth are (a) every leaf is dispositioned
 * at all and (b) the canary sweep. The classes that actually let a value ESCAPE
 * are narrow on purpose: `process-egress` (an AI provider) admits only what
 * this repository wrote or explicitly redacted, and `os-notification` — text
 * that can render on a lock screen — admits only repository-authored strings,
 * which is exactly ref dashboard-surfaces §2.6's "no raw secrets or captured form contents in
 * notification text" expressed as a schema property rather than a promise.
 *
 * This module deliberately does NOT re-implement redaction, re-derive a
 * classification, or restate `no-secret-values-in-logs.test.ts` (env-sourced
 * credentials in log calls), `secrets-single-source.test.ts`,
 * `evidence-receipt.test.ts` (the receipt's own canaries and its
 * declaration-time refusals) or `notification-durability.test.ts`. It audits the SURFACES those guards
 * each look at one at a time, in one sweep, in both directions.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import {
  ActionDescriptorWireSchema,
} from "../../../../src/domain/dashboard/actions.js";
import { ActivityReportWireSchema } from "../../../../src/domain/dashboard/activity.js";
import { RunAdvisoryWireSchema } from "../../../../src/domain/dashboard/advisory.js";
import {
  ArchivedCaptureResourceWireSchema,
  ArchivedRunDetailWireSchema,
  ArchiveIndexWireSchema,
  VersionBumpPlanWireSchema,
} from "../../../../src/domain/dashboard/archive.js";
import {
  ArtifactResourceWireSchema,
  CapturePointerWireSchema,
} from "../../../../src/domain/dashboard/artifacts.js";
import { FrontendBootstrapWireSchema } from "../../../../src/domain/dashboard/bootstrap.js";
import { DiagnosticBundleWireSchema } from "../../../../src/domain/dashboard/diagnostic-bundle.js";
import {
  ExplorerEditApplyResultSchema,
  ExplorerEditValidationResultSchema,
  ExplorerOverrideDocumentSchema,
  UiCatalogWireSchema,
  WorkflowExplorerWireSchema,
} from "../../../../src/domain/dashboard/explorer.js";
import {
  DashboardDayWireSchema,
  QueueSurfaceWireSchema,
} from "../../../../src/domain/dashboard/projection.js";
import { RunReceiptComparisonWireSchema } from "../../../../src/domain/dashboard/run-comparison.js";
import {
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
} from "../../../../src/domain/dashboard/run-detail.js";
import { CrossDateSearchPageSchema } from "../../../../src/domain/dashboard/search.js";
import { SettingsFactsWireSchema } from "../../../../src/domain/dashboard/settings.js";
import { EditableSettingsWireSchema } from "../../../../src/domain/dashboard/settings-editor.js";
import { StorageDoctorWireSchema } from "../../../../src/domain/dashboard/storage.js";
import { DashboardStreamEnvelopeSchema } from "../../../../src/domain/dashboard/subscription.js";
import { OperatorXlsxExportEvidenceSchema } from "../../../../src/domain/dashboard/xlsx-export.js";
import { IntakeSessionWireSchema } from "../../../../src/domain/intake/wire.js";
import { LedgerEntrySchema } from "../../../../src/domain/ledger.js";
import {
  NotificationProjectionSchema,
  NotificationTriggerEventSchema,
} from "../../../../src/domain/notification-triggers.js";
import { NotificationRecordSchema } from "../../../../src/domain/notifications.js";
import { AdvisoryPromptSchema } from "../../../../src/domain/trust/advisory.js";
import { DiagnosticBundleSchema } from "../../../../src/domain/trust/diagnostic.js";
import { RunEvidenceReceiptSchema } from "../../../../src/domain/trust/evidence.js";
import { FailureRecordSchema } from "../../../../src/domain/trust/failure.js";
import { REPO_ROOT, repoRelative, walkFiles } from "./guard-files.js";

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
  "external-text",
]);
export type LeafOrigin = z.infer<typeof LeafOriginSchema>;

/**
 * `permitted` needs nothing; `exception` needs a written reason on the row;
 * `refused` cannot be written down at all — the field has to change.
 */
const ORIGIN_RULE_BY_EGRESS: Readonly<
  Record<SurfaceEgress, Readonly<Record<LeafOrigin, "permitted" | "exception" | "refused">>>
> = Object.freeze({
  "operator-loopback": {
    "repository-authored": "permitted",
    "operator-authored": "permitted",
    "declared-redacted": "permitted",
    "local-filesystem-name": "permitted",
    "captured-hr-value": "permitted",
    "external-text": "permitted",
  },
  "durable-authority": {
    "repository-authored": "permitted",
    "operator-authored": "exception",
    "declared-redacted": "permitted",
    "local-filesystem-name": "permitted",
    "captured-hr-value": "permitted",
    "external-text": "exception",
  },
  "durable-file": {
    "repository-authored": "permitted",
    "operator-authored": "permitted",
    "declared-redacted": "permitted",
    "local-filesystem-name": "permitted",
    "captured-hr-value": "exception",
    "external-text": "refused",
  },
  "process-egress": {
    "repository-authored": "permitted",
    "operator-authored": "refused",
    "declared-redacted": "permitted",
    "local-filesystem-name": "refused",
    "captured-hr-value": "refused",
    "external-text": "refused",
  },
  "os-notification": {
    "repository-authored": "permitted",
    "operator-authored": "refused",
    "declared-redacted": "refused",
    "local-filesystem-name": "refused",
    "captured-hr-value": "refused",
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

/**
 * A redaction arm is recognised STRUCTURALLY — every arm of the union declares
 * `state`, `classification` and `transform` — rather than by comparing against
 * a pre-serialized `RedactedFieldSchema`. The comparison would be the more
 * obvious check and it does not work: once the schema is embedded inside a
 * larger surface, `z.toJSONSchema` may hoist shared subtrees behind `$ref`, so
 * a byte comparison silently stops matching and every redacted value would
 * decompose into a free-text `key` plus an open `value`. The signature is what
 * makes the value self-describing, so the signature is what is matched.
 */
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

/**
 * Every leaf of a surface, one row per path, keeping the STRICTEST kind a path
 * reaches. A union arm that spells one path as an enum and another as a bare
 * string must be audited as the bare string — taking the last (or first) match
 * would let an absent/present union hide its free-text half.
 */
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

/**
 * A field whose NAME promises redaction and whose producer does not deliver
 * it. Waiving one is a deliberate, named act; the reason has to say what the
 * value really is and why the surface may carry it, because the danger of a
 * `*Redacted` field that is not redacted is precisely that nobody looks twice.
 */
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
        + "`valueRedacted`, and src/server/dashboard/queries/run-detail.ts serves the RAW recorded "
        + "value — the descriptor-declared detail patch, the stored checkpoint scalar, or a count. "
        + "That is ref dashboard-surfaces §1.1(c)'s Data rail working as designed: the operator's own loopback "
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
          + "tests/unit/architecture/helpers/redaction-surface-audit.ts — a wire field is not "
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

/* ── 4. the module ratchet ────────────────────────────────────────────────── */

/**
 * Every module that can declare a wire or durable surface, and what this guard
 * does about it. A NEW file under one of the scanned roots is a guard failure
 * until it is either audited or explicitly deferred with a reason — otherwise a
 * whole new surface could ship without one leaf being reviewed.
 */
export const SurfaceModuleDispositionSchema = z.strictObject({
  module: z.string().min(1),
  state: z.enum(["audited", "no-surface"]),
  reason: z.string().min(20),
});
export type SurfaceModuleDisposition = z.infer<typeof SurfaceModuleDispositionSchema>;

export const SURFACE_MODULE_ROOTS: readonly string[] = Object.freeze([
  "src/domain/dashboard",
]);

/** Surface-bearing modules outside the scanned roots, named one by one. */
export const EXTRA_SURFACE_MODULES: readonly string[] = Object.freeze([
  "src/domain/intake/wire.ts",
  "src/domain/ledger.ts",
  "src/domain/notification-triggers.ts",
  "src/domain/notifications.ts",
  "src/domain/trust/diagnostic.ts",
  "src/domain/trust/evidence.ts",
  "src/domain/trust/failure.ts",
  "src/domain/trust/advisory.ts",
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

/**
 * Ref clock-config-secrets §6: "Tests seed canary passwords, cookies, storage state, SSNs, DOBs,
 * and private keys and scan every produced note/failure/screenshot metadata/
 * bundle/notification." Each value below is deliberately impossible in real
 * data — an unissued SSN area, an impossible birth date, a nonsense name — so a
 * hit is never a coincidence, and each is long enough that a `last4`, a digest
 * or a basename of it cannot contain the whole sentinel.
 */
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

/**
 * The canaries that must never appear on ANY surface, in any egress class. A
 * credential is never evidence and a regulated identifier is never a
 * transaction fact, so there is no surface either of them belongs on — unlike a
 * person's name, which the operator's own loopback rail carries by design.
 */
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
  { id: "wire/run-detail", egress: "operator-loopback", module: "src/domain/dashboard/run-detail.ts", schema: RunDetailWireSchema },
  { id: "wire/run-detail-section", egress: "operator-loopback", module: "src/domain/dashboard/run-detail.ts", schema: RunDetailSectionResponseSchema },
  { id: "wire/run-receipt-comparison", egress: "operator-loopback", module: "src/domain/dashboard/run-comparison.ts", schema: RunReceiptComparisonWireSchema },
  { id: "wire/queue-surface", egress: "operator-loopback", module: "src/domain/dashboard/projection.ts", schema: QueueSurfaceWireSchema },
  { id: "wire/dashboard-day", egress: "operator-loopback", module: "src/domain/dashboard/projection.ts", schema: DashboardDayWireSchema },
  { id: "wire/stream-envelope", egress: "operator-loopback", module: "src/domain/dashboard/subscription.ts", schema: DashboardStreamEnvelopeSchema },
  { id: "wire/bootstrap", egress: "operator-loopback", module: "src/domain/dashboard/bootstrap.ts", schema: FrontendBootstrapWireSchema },
  { id: "wire/diagnostic-bundle", egress: "operator-loopback", module: "src/domain/dashboard/diagnostic-bundle.ts", schema: DiagnosticBundleWireSchema },
  { id: "wire/activity-report", egress: "operator-loopback", module: "src/domain/dashboard/activity.ts", schema: ActivityReportWireSchema },
  { id: "wire/cross-date-search", egress: "operator-loopback", module: "src/domain/dashboard/search.ts", schema: CrossDateSearchPageSchema },
  { id: "wire/run-advisory", egress: "operator-loopback", module: "src/domain/dashboard/advisory.ts", schema: RunAdvisoryWireSchema },
  { id: "wire/action-descriptor", egress: "operator-loopback", module: "src/domain/dashboard/actions.ts", schema: ActionDescriptorWireSchema },
  { id: "wire/artifact-resource", egress: "operator-loopback", module: "src/domain/dashboard/artifacts.ts", schema: ArtifactResourceWireSchema },
  // Declared, strict-schema-tested, and not yet served by any route. It is
  // registered anyway: a surface reviewed before it ships is the only kind that
  // cannot ship unreviewed.
  { id: "wire/capture-pointer", egress: "operator-loopback", module: "src/domain/dashboard/artifacts.ts", schema: CapturePointerWireSchema },
  { id: "wire/storage-doctor", egress: "operator-loopback", module: "src/domain/dashboard/storage.ts", schema: StorageDoctorWireSchema },
  { id: "wire/settings-facts", egress: "operator-loopback", module: "src/domain/dashboard/settings.ts", schema: SettingsFactsWireSchema },
  { id: "wire/editable-settings", egress: "operator-loopback", module: "src/domain/dashboard/settings-editor.ts", schema: EditableSettingsWireSchema },
  { id: "wire/workflow-explorer", egress: "operator-loopback", module: "src/domain/dashboard/explorer.ts", schema: WorkflowExplorerWireSchema },
  { id: "wire/explorer-edit-validation", egress: "operator-loopback", module: "src/domain/dashboard/explorer.ts", schema: ExplorerEditValidationResultSchema },
  { id: "wire/explorer-edit-apply", egress: "operator-loopback", module: "src/domain/dashboard/explorer.ts", schema: ExplorerEditApplyResultSchema },
  { id: "wire/ui-catalog", egress: "operator-loopback", module: "src/domain/dashboard/explorer.ts", schema: UiCatalogWireSchema },
  { id: "wire/archive-index", egress: "operator-loopback", module: "src/domain/dashboard/archive.ts", schema: ArchiveIndexWireSchema },
  { id: "wire/archived-run-detail", egress: "operator-loopback", module: "src/domain/dashboard/archive.ts", schema: ArchivedRunDetailWireSchema },
  { id: "wire/archived-capture-resource", egress: "operator-loopback", module: "src/domain/dashboard/archive.ts", schema: ArchivedCaptureResourceWireSchema },
  { id: "wire/version-bump-plan", egress: "operator-loopback", module: "src/domain/dashboard/archive.ts", schema: VersionBumpPlanWireSchema },
  { id: "wire/intake-session", egress: "operator-loopback", module: "src/domain/intake/wire.ts", schema: IntakeSessionWireSchema },
  { id: "durable/failure-record", egress: "durable-authority", module: "src/domain/trust/failure.ts", schema: FailureRecordSchema },
  { id: "durable/evidence-receipt", egress: "durable-authority", module: "src/domain/trust/evidence.ts", schema: RunEvidenceReceiptSchema },
  { id: "durable/notification-record", egress: "durable-authority", module: "src/domain/notifications.ts", schema: NotificationRecordSchema },
  { id: "durable/diagnostic-bundle", egress: "durable-authority", module: "src/domain/trust/diagnostic.ts", schema: DiagnosticBundleSchema },
  { id: "durable/operator-xlsx-export", egress: "durable-authority", module: "src/domain/dashboard/xlsx-export.ts", schema: OperatorXlsxExportEvidenceSchema },
  { id: "file/ledger-entry", egress: "durable-file", module: "src/domain/ledger.ts", schema: LedgerEntrySchema },
  { id: "file/explorer-overrides", egress: "durable-file", module: "src/domain/dashboard/explorer.ts", schema: ExplorerOverrideDocumentSchema },
  { id: "egress/advisory-prompt", egress: "process-egress", module: "src/domain/trust/advisory.ts", schema: AdvisoryPromptSchema },
  { id: "os/notification-projection", egress: "os-notification", module: "src/domain/notification-triggers.ts", schema: NotificationProjectionSchema },
  { id: "os/notification-trigger-event", egress: "os-notification", module: "src/domain/notification-triggers.ts", schema: NotificationTriggerEventSchema },
] satisfies readonly RedactionSurface[]);

/**
 * Where every free-text and open-JSON leaf of every registered surface comes
 * from. Generated ONCE from the schemas and then reviewed line by line; it is
 * maintained by hand from here, because the value of the table is precisely
 * that a human answered the question for each row.
 */
export const SURFACE_LEAF_ORIGINS: readonly SurfaceLeafOrigin[] = Object.freeze(
  SurfaceLeafOriginSchema.array().parse([
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
  // D292 payload.artifacts[].origins[] carries only format-constrained bundleId
  // and closed originKind leaves. The scanner classifies these mechanically;
  // no actor/failure detail or new free-text origin exception is introduced.

  { surface: "wire/run-detail-section", path: "payload.editing.reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.entries[].edit.pendingCorrection.value", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.entries[].edit.reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.entries[].edit.value", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.entries[].label", origin: "repository-authored" },
  // D252 — a step's display name and a commit node's, both `runtimeNodeLabel`
  // over an authored `label` or the task contract's own `title`. Repository
  // source in every arm: the fallback is the node ID, which is authored too.
  { surface: "wire/run-detail-section", path: "payload.entries[].origin.step", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.entries[].freshness.feeds[].label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.entries[].valueRedacted", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.members[].label", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.message", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.notes[].message", origin: "external-text" },
  { surface: "wire/run-detail-section", path: "payload.rows[].note.message", origin: "external-text" },

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

  /*
   * The parked-write section (ref write-safety §4.1). Its served actions are the same
   * server-authored `ActionDescriptorWire` leaves already dispositioned under
   * `wire/action-descriptor`, reached one level deeper.
   *
   * `payload.parkedMessage` is `external-text` and NOT repository-authored,
   * which is the disposition that matters here: ref write-safety §4's `park()` builds it
   * by interpolating a thrown driver error's `message` and a probe verdict's
   * own `reason`. Nobody in this repository controls those bytes. It stays on
   * the loopback surface because "why did this stop" is the whole question the
   * panel answers, and loopback admits every origin.
   *
   * `payload.subject` needs no entry at all, and that is the point of serving
   * the DURABLE `SubjectEvidenceSchema` verbatim: every one of its arms is a
   * digest, a branded id, or a pattern-bounded string, so the walker decides
   * them without a human disposition. A re-projection would have introduced
   * exactly the free-text leaves this table exists to interrogate.
   */
  { surface: "wire/run-detail-section", path: "payload.actions[].confirm.body", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].confirm.confirmLabel", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].confirm.title", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].detail", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].key", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.actions[].navigate.runId", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.parkedMessage", origin: "external-text" },

  /*
   * D245's proof contract. Every leaf here is DERIVED FROM A SCHEMA THIS
   * REPOSITORY DECLARES — `describeProofShape` walks a commit contract's own
   * `completion.proofSchema` — so none of it can carry a person's data: the
   * bytes are literal discriminators, regex sources, and enum option lists that
   * a contract author typed into `src/domain/contracts/**`.
   *
   * `reason` is the same authorship one level over. It is composed by
   * `parkedWriteProofContract` from the workflow id, the intent's task id, and
   * the describer's own refusal sentence — all repository-authored — and its
   * whole job is to name what this build cannot describe, which is a fact about
   * the build rather than about the run's subject.
   *
   * The thing to check on any future edit is exactly that provenance: if a
   * describer ever carried a zod `.default()`, an example, or an error message
   * built from parsed DATA, these stop being repository-authored and this table
   * has to say so.
   */
  { surface: "wire/run-detail-section", path: "payload.proofContract.fields[].options[]", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.proofContract.fields[].pattern", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.proofContract.fields[].value", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.proofContract.reason", origin: "repository-authored" },

  /*
   * The identity-approval gate section (ref write-safety §14.4, separations chunk 3).
   *
   * This is the one loopback payload that carries a person's identity in the
   * CLEAR, and the disposition is the review of exactly that: §14.4's acceptance
   * standard is that the operator decides who is being separated *without
   * leaving the dashboard*, so names, EIDs, departments and titles are the
   * decision rather than incidental detail. Every one of them is
   * `captured-hr-value` — read off UCPath or off the separation document — and
   * loopback is the only egress that may carry them. Nothing here may be
   * re-exported to a wider surface without re-deciding this table's rows.
   *
   * The split is the same one D197 settled on the Kuali read: a value the PAGE
   * showed is `captured-hr-value`; a sentence this repository composed ABOUT
   * that value (a comparison's `note`, an option's `origin`, an action's copy)
   * is `repository-authored`, even when it interpolates a captured value.
   */
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
  // The gate packet's WRITE PLAN block (chunk 6, `write-plan.ts`) — what the
  // two writes will consume, rendered so the operator approves the VALUES and
  // not only the person. It rides the same operator-loopback section as the
  // rest of the packet and for the same reason (§14.4: the operator decides
  // without leaving the dashboard). Templates, reason codes and comment text
  // are repository-authored; every date, code, title and department came off a
  // real page.
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
  { surface: "wire/run-detail-section", path: "payload.value.packet.plan.document.timekeeperName", origin: "captured-hr-value" },
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

  /*
   * The queue row's own served controls (ref frontend-backend-integration §8.5). Every leaf is authored
   * by `server/dashboard/projectors/queue-row-actions.ts` — a fixed label set
   * plus confirm copy whose only interpolations are the workflow's DESCRIPTOR
   * label and a member COUNT. No captured HR value reaches it, and that is a
   * deliberate constraint of that module rather than an accident of the current
   * copy: the row's own title is rendered by `ConfirmCommandDialog` as a
   * separate subject line, so a served body never has to name the person.
   */
  { surface: "wire/queue-surface", path: "actions[].confirm.body", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].confirm.confirmLabel", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].confirm.title", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].detail", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].key", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].label", origin: "repository-authored" },
  { surface: "wire/queue-surface", path: "actions[].navigate.runId", origin: "repository-authored" },

  { surface: "wire/dashboard-day", path: "notifications[].title", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].appVersion.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].endedAt.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].gateOpenedAt.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].displayName.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].displayName.value", origin: "external-text" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].liveMessage.reason", origin: "repository-authored" },
  { surface: "wire/dashboard-day", path: "queueSurfaces[].liveMessage.value", origin: "external-text" },
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
  { surface: "wire/stream-envelope", path: "payload.notes[].message", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.rows[].note.message", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.rows[].producer.step", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.rows[].spanPath", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.notifications[].title", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.outcome.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].appVersion.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].endedAt.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].gateOpenedAt.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].displayName.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].displayName.value", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].liveMessage.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.queueSurfaces[].liveMessage.value", origin: "external-text" },
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
  // The doctor's four free-text leaves. Every one is written in THIS
  // repository's own check table — the label names a check, the detail states
  // what it found about the local environment, `blocks` names the workflows a
  // failure would break, and `remediation` is the fix somebody wrote down. A
  // preflight check reads local configuration and never a person's record, so
  // none of these may ever carry a captured HR value; a check that wanted to
  // quote one would need its own origin row and a reviewer.
  { surface: "wire/bootstrap", path: "preflight[].blocks[]", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "preflight[].detail", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "preflight[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "preflight[].remediation", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "settingsSections[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "systemInstances[].test.reason", origin: "repository-authored" },
  // `workflowCategories[].label` retired with R2 D17/D18: the server invented
  // that heading from the id, and the display label + order are the
  // frontend's (`dashboard/surfaces/workflow-category.ts`).
  { surface: "wire/bootstrap", path: "workflows[].availability.reason", origin: "repository-authored" },
  // `workflows[].code` needs no row on ANY surface: `WorkflowCodeSchema`
  // constrains it to two-to-four lowercase letters at the wire boundary
  // (D242), so the scan does not read it as a free-text leaf.
  { surface: "wire/bootstrap", path: "workflows[].label", origin: "repository-authored" },
  /**
   * D264/D11 — the served start block. Every leaf of it is a DESCRIPTOR
   * CONSTANT: a sentence, a placeholder, a delimiter or a worked example that a
   * developer typed into `src/workflows/<id>/descriptor.ts` and this repository
   * ships. Nothing here is read from UCPath, Kuali or an operator's box — the
   * block moved onto the wire precisely so the browser would stop holding the
   * descriptors that declare it, and moving a constant does not change where its
   * bytes came from.
   *
   * The one leaf that needs saying out loud is `examples[].text`: it is the
   * text the modal TYPES FOR the operator (D250), so it looks like a subject
   * identifier and is not one — `defineWorkflowDescriptor` proves every example
   * parses and satisfies the workflow's own input schema, and the values are
   * the fabricated demonstration EIDs and names the descriptor authors chose.
   * A real person's identifier in an example would be a repository defect, not
   * a wire one.
   */
  { surface: "wire/bootstrap", path: "workflows[].start.summary", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.placeholder", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.parser.split.delimiters[]", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.parser.constants[].value.text", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.examples[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.examples[].note", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.inputRun.examples[].text", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.steps[].label", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.steps[].control.inputField", origin: "repository-authored" },
  { surface: "wire/bootstrap", path: "workflows[].start.steps[].control.reason", origin: "repository-authored" },

  { surface: "wire/activity-report", path: "categories[].category.reason", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "durations.longestMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "durations.medianMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "people.reason", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "workflows[].registration.label", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "workflows[].registration.reason", origin: "repository-authored" },

  // Cross-date search exposes only server-authored prose and one HMAC-signed,
  // process-local continuation. No row title, subject value or artifact fact
  // is admitted by the schema.
  { surface: "wire/cross-date-search", path: "nextCursor.reason", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "nextCursor.value", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "snapshot.token", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "results[].endedAt.reason", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "results[].retryOf.reason", origin: "repository-authored" },
  { surface: "wire/cross-date-search", path: "results[].runNumber.reason", origin: "repository-authored" },

  { surface: "wire/run-advisory", path: "outcome.advice.checks[].what", origin: "external-text" },
  { surface: "wire/run-advisory", path: "outcome.advice.checks[].why", origin: "external-text" },
  { surface: "wire/run-advisory", path: "outcome.advice.explanation", origin: "external-text" },
  { surface: "wire/run-advisory", path: "outcome.advice.headline", origin: "external-text" },
  { surface: "wire/run-advisory", path: "outcome.reason", origin: "repository-authored" },

  { surface: "wire/action-descriptor", path: "confirm.body", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "confirm.confirmLabel", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "confirm.title", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "detail", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "key", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "label", origin: "repository-authored" },
  { surface: "wire/action-descriptor", path: "navigate.runId", origin: "repository-authored" },

  { surface: "wire/artifact-resource", path: "message", origin: "repository-authored" },
  { surface: "wire/artifact-resource", path: "reason", origin: "repository-authored" },

  // D183: queries/archive.ts composes the exact-id URL and fixed availability
  // copy; no stored capture value, filesystem path, or caught error is copied.
  { surface: "wire/archived-capture-resource", path: "resource.downloadUrl", origin: "repository-authored" },
  { surface: "wire/archived-capture-resource", path: "resource.message", origin: "repository-authored" },
  { surface: "wire/archived-capture-resource", path: "resource.reason", origin: "repository-authored" },

  { surface: "wire/capture-pointer", path: "dimensions.reason", origin: "repository-authored" },

  { surface: "wire/storage-doctor", path: "authority.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "authority.cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor", path: "backup.cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "backup.cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor", path: "backup.latest.backupFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor", path: "backup.latest.generationGap.reason", origin: "repository-authored" },
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
  { surface: "wire/storage-doctor", path: "restoreCandidates[].manifestFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor", path: "service.message", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "service.reason", origin: "repository-authored" },
  // D282 diagnostics are loopback-only. Parser/read failures can contribute
  // external text, while filenames and authority keys are separately typed
  // origins; the wire schema additionally refuses a full UCPath identifier in
  // either message leaf.
  { surface: "wire/storage-doctor", path: "spanAuthority.problems[].recordKey", origin: "repository-authored" },

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
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].coveragePoints[].detail", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].coveragePoints[].id", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].details[].key", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].details[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].editableFields[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].label", origin: "repository-authored" },
  // D229 — the descriptor's own prose, and the projection's own sentence naming
  // the file that owes one. Both are written in this repository; neither can
  // carry a value read off a page, a run, or a person.
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].purpose.text", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].purpose.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].summary.text", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].summary.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.branches[].id", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.cases[].name", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.edgeId", origin: "repository-authored" },
  // D228 — the scalar a declared `when` compares against, written in the
  // descriptor's own source. A condition is data about the GRAPH; nothing about
  // a run, a person, or a page can reach it.
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.condition.value", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.statusKey", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].binding.note", origin: "repository-authored" },
  // D227 — a field census leaf. `options[]` is the closed vocabulary an enum or
  // literal declares IN THE SOURCE, and `recorded.reason` is one of a handful of
  // sentences this repository's own projection composes. Neither can carry a
  // value read off a live page: the census walks a schema, not a run.
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
  // D283 — compile evidence and code-change briefs are assembled only from the
  // registered descriptor/module/scenario graph and the protocol's closed
  // literals. The canonical patch expressions are serialized by the service;
  // they are never free-form operator TypeScript.
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

  { surface: "file/explorer-overrides", path: "workflows[].presentation.label", origin: "operator-authored" },

  { surface: "wire/ui-catalog", path: "entries[].label", origin: "repository-authored" },
  { surface: "wire/ui-catalog", path: "entries[].searchTerms[]", origin: "repository-authored" },

  { surface: "wire/archive-index", path: "entries[].appVersion.reason", origin: "repository-authored" },
  { surface: "wire/archive-index", path: "entries[].endedAt.reason", origin: "repository-authored" },
  { surface: "wire/archive-index", path: "entries[].title", origin: "captured-hr-value" },
  { surface: "wire/archive-index", path: "entries[].workflowLabel", origin: "repository-authored" },
  { surface: "wire/archive-index", path: "entries[].workflowCode.reason", origin: "repository-authored" },
  { surface: "wire/archive-index", path: "entries[].warnings.first", origin: "external-text" },
  { surface: "wire/archive-index", path: "entries[].warnings.reason", origin: "repository-authored" },
  { surface: "wire/archive-index", path: "plans[].blockers[].title", origin: "captured-hr-value" },
  { surface: "wire/archive-index", path: "plans[].candidates[].title", origin: "captured-hr-value" },
  { surface: "wire/archive-index", path: "versionState[].blockers[].title", origin: "captured-hr-value" },
  { surface: "wire/archive-index", path: "versionState[].workflowLabel", origin: "repository-authored" },

  /*
   * D223's frozen sections. Every leaf below is the SAME leaf the live
   * run-detail section carries, frozen — so each takes the disposition its
   * live twin already has, and the two lists are read together on purpose: a
   * frozen copy that quietly relaxed an origin would be a redaction downgrade
   * nobody reviewed.
   *
   * `captures[].system.value` is `repository-authored` because it is the
   * declared store half of a `TaskIdSchema` (`<registered-store>/<operation>`),
   * which is a closed set this repository owns — not a value any external
   * system supplied.
   */
  { surface: "wire/archived-run-detail", path: "workflowCode.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.logs.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.logs.value.notes[].message", origin: "external-text" },
  { surface: "wire/archived-run-detail", path: "sections.value.data.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.data.value.editing.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.data.value.entries[].label", origin: "repository-authored" },
  // D252 — a step's display name and a commit node's, both `runtimeNodeLabel`
  // over an authored `label` or the task contract's own `title`. Repository
  // source in every arm: the fallback is the node ID, which is authored too.
  { surface: "wire/archived-run-detail", path: "sections.value.data.value.entries[].origin.step", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.data.value.entries[].freshness.feeds[].label", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.data.value.entries[].valueRedacted", origin: "captured-hr-value" },
  { surface: "wire/archived-run-detail", path: "sections.value.data.value.entries[].edit.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.data.value.entries[].edit.value", origin: "captured-hr-value" },
  { surface: "wire/archived-run-detail", path: "sections.value.data.value.entries[].edit.pendingCorrection.value", origin: "captured-hr-value" },
  { surface: "wire/archived-run-detail", path: "sections.value.people.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.people.value.members[].label", origin: "captured-hr-value" },
  { surface: "wire/archived-run-detail", path: "sections.value.attempts.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.attempts.value[].startedAt.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.attempts.value[].endedAt.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.captures.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.captures.value[].step.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.captures.value[].system.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.captures.value[].system.value", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "detail.captures.message", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "detail.captures.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.captures.message", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.captures.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.captures.message", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.replacement.captures.reason", origin: "repository-authored" },
  /*
   * Charter §25's change record. `what`, `why` and `commit.value` are typed by
   * the OPERATOR, so they are `external-text` on the same terms as an
   * operator-assigned `displayName`: free text this repository did not author
   * and may not claim to have bounded. The two `reason` halves are ours.
   */
  { surface: "wire/archive-index", path: "sweeps[].changeRecord.reason", origin: "repository-authored" },
  { surface: "wire/archive-index", path: "sweeps[].changeRecord.value.what", origin: "external-text" },
  { surface: "wire/archive-index", path: "sweeps[].changeRecord.value.why", origin: "external-text" },
  { surface: "wire/archive-index", path: "sweeps[].changeRecord.value.commit.value", origin: "external-text" },
  { surface: "wire/archive-index", path: "sweeps[].changeRecord.value.commit.reason", origin: "external-text" },
  { surface: "wire/archive-index", path: "plans[].changeRecord.reason", origin: "repository-authored" },
  { surface: "wire/archive-index", path: "plans[].changeRecord.value.what", origin: "external-text" },
  { surface: "wire/archive-index", path: "plans[].changeRecord.value.why", origin: "external-text" },
  { surface: "wire/archive-index", path: "plans[].changeRecord.value.commit.value", origin: "external-text" },
  { surface: "wire/archive-index", path: "plans[].changeRecord.value.commit.reason", origin: "external-text" },
  { surface: "wire/version-bump-plan", path: "changeRecord.reason", origin: "repository-authored" },
  { surface: "wire/version-bump-plan", path: "changeRecord.value.what", origin: "external-text" },
  { surface: "wire/version-bump-plan", path: "changeRecord.value.why", origin: "external-text" },
  { surface: "wire/version-bump-plan", path: "changeRecord.value.commit.value", origin: "external-text" },
  { surface: "wire/version-bump-plan", path: "changeRecord.value.commit.reason", origin: "external-text" },
  { surface: "wire/archived-run-detail", path: "appVersion.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.logs.value.rows[].note.message", origin: "external-text" },
  { surface: "wire/archived-run-detail", path: "sections.value.logs.value.rows[].producer.step", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "sections.value.logs.value.rows[].spanPath", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "ledger[].pointer.system", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "ledger[].system", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "ledger[].reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "ledger[].action.value", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "ledger[].action.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "ledger[].confirmation.value", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "ledger[].confirmation.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "detail.timeline.events[].durationMs.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "retention.row.basis", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "retention.row.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "retention.eventStreams.basis", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "retention.eventStreams.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "retention.evidence.basis", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "retention.evidence.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "retention.ledger.basis", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "retention.ledger.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "retention.pointers.basis", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.actions[].confirm.body", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.actions[].confirm.confirmLabel", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.actions[].confirm.title", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.actions[].detail", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.actions[].key", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.actions[].label", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.actions[].navigate.runId", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "detail.gate.label", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "detail.gate.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "detail.header.title", origin: "captured-hr-value" },
  { surface: "wire/archived-run-detail", path: "detail.outcome.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "detail.timeline.events[].label", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "detail.timeline.steps[].label", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "detail.timeline.steps[].members[].label", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "detail.timeline.events[].notRun.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "evidence.ledgerPartitions[].system", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "failure.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "failure.value.causeChain[].summary", origin: "external-text" },
  { surface: "wire/archived-run-detail", path: "failure.value.diagnosticBundle.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "failure.value.page.titleRedacted", origin: "declared-redacted" },
  { surface: "wire/archived-run-detail", path: "failure.value.page.urlRedacted", origin: "declared-redacted" },
  { surface: "wire/archived-run-detail", path: "failure.value.remediation[].message", origin: "external-text" },
  { surface: "wire/archived-run-detail", path: "failure.value.subject.expected.displayRedacted", origin: "declared-redacted" },
  { surface: "wire/archived-run-detail", path: "failure.value.subject.observed.displayRedacted", origin: "declared-redacted" },
  { surface: "wire/archived-run-detail", path: "failure.value.subject.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "failure.value.summary", origin: "external-text" },
  { surface: "wire/archived-run-detail", path: "receipt.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "receipt.value.decisions[].reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "receipt.value.input[].reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "receipt.value.observations[].reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "receipt.value.output[].reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "receipt.value.warnings[].summary", origin: "external-text" },
  { surface: "wire/archived-run-detail", path: "relaunch.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.appVersion.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.endedAt.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.gateOpenedAt.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.displayName.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.displayName.value", origin: "external-text" },
  { surface: "wire/archived-run-detail", path: "row.liveMessage.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.liveMessage.value", origin: "external-text" },
  { surface: "wire/archived-run-detail", path: "row.pipeline[].label", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.subtitle.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.subtitle.value", origin: "captured-hr-value" },
  { surface: "wire/archived-run-detail", path: "row.title", origin: "captured-hr-value" },
  { surface: "wire/archived-run-detail", path: "row.warnings.first", origin: "external-text" },
  { surface: "wire/archived-run-detail", path: "row.warnings.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "workflowLabel", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.runNumber.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.session.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.facts.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.facts.value[].label", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.facts.value[].value", origin: "captured-hr-value" },
  { surface: "wire/archived-run-detail", path: "row.linkedRuns[].label", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.memberPreview.reason", origin: "repository-authored" },
  { surface: "wire/archived-run-detail", path: "row.memberPreview.value", origin: "captured-hr-value" },

  { surface: "wire/version-bump-plan", path: "blockers[].title", origin: "captured-hr-value" },
  { surface: "wire/version-bump-plan", path: "candidates[].title", origin: "captured-hr-value" },

  { surface: "wire/intake-session", path: "columns[].header", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "columns[].normalizedHeader", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "columns[].samples[]", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "constants[].value", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "corrections[].correctedValue", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "exclusions[].reason", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "headerCandidates[].cells[]", origin: "captured-hr-value" },
  // Terminal valid inputs come from the immutable manifest loaded by exact id;
  // rerun removed rows are those same durable facts, while added rows are the
  // canonical inputs revalidated from the session's immutable source artifact.
  { surface: "wire/intake-session", path: "manifest.validRows[].parsedInput", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "rerun.diff.added[].parsedInput", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "rerun.diff.changes[].now", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "rerun.diff.changes[].was", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "rerun.diff.removed[].parsedInput", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "sheet", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "sheets[]", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "sourceName", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "targets[].label", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "validation.rejected[].column.header", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "validation.rejected[].issues[].code", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "validation.rejected[].issues[].message", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "validation.rejected[].issues[].path[]", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "validation.rejected[].path[]", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "validation.rejected[].reason", origin: "repository-authored" },

  // E29 derives the display key/detail around a closed attachment kind, its
  // stored metadata and a verified digest; neither is captured page text.
  // Media types are driver declarations, and D137 warnings are emitted by the
  // capture-time classifier rather than copied from an inspected page.
  { surface: "wire/diagnostic-bundle", path: "contents[].key", origin: "repository-authored" },
  { surface: "wire/diagnostic-bundle", path: "contents[].detail", origin: "repository-authored" },
  { surface: "wire/diagnostic-bundle", path: "contents[].mediaType", origin: "repository-authored" },
  { surface: "wire/diagnostic-bundle", path: "redaction.warnings[]", origin: "repository-authored" },

  // D289 allows only reviewed safe-diagnostic values into before/after; labels
  // are fixed by the closed Separations registry rather than copied from a receipt.
  { surface: "wire/run-receipt-comparison", path: "facts[].after", origin: "captured-hr-value" },
  { surface: "wire/run-receipt-comparison", path: "facts[].before", origin: "captured-hr-value" },
  { surface: "wire/run-receipt-comparison", path: "facts[].label", origin: "repository-authored" },

  { surface: "durable/failure-record", path: "causeChain[].summary", origin: "external-text",
    exception: "each cause's own thrown message, same reason as `summary` and dropped by the same advisory declaration." },
  { surface: "durable/failure-record", path: "page.titleRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "page.urlRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "remediation[].message", origin: "external-text",
    exception: "composed beside a closed `kind`, but it may quote the thrown message, so it is held to the untrusted class rather than assumed authored." },
  { surface: "durable/failure-record", path: "subject.expected.displayRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "subject.observed.displayRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "summary", origin: "external-text",
    exception: "ref operator-trust SS2.1 / D142: `error.message` verbatim is what tells the operator WHY, and the charter requires a thrown message to name the offending value. It is durable and operator-visible on purpose; the advisory drops it (advisory.ts `withheld`) precisely because that surface leaves the machine." },

  { surface: "durable/evidence-receipt", path: "decisions[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "input[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "observations[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "output[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "warnings[].summary", origin: "external-text",
    exception: "src/core/evidence-receipt.ts copies `failure.summary` into the uncertainty warning; the receipt inherits the failure record's exception, not a second one." },

  { surface: "durable/notification-record", path: "summary", origin: "repository-authored" },
  { surface: "durable/notification-record", path: "title", origin: "repository-authored" },

  { surface: "durable/diagnostic-bundle", path: "redaction.warnings[]", origin: "repository-authored" },

  // DCR5 retains the exact operator query only in insert-only evidence; it is
  // deliberately absent from workbook cells because it may itself be an
  // identifier. Attachment syntax and sheet names are closed composition facts.
  { surface: "durable/operator-xlsx-export", path: "download.contentDisposition", origin: "repository-authored" },
  { surface: "durable/operator-xlsx-export", path: "selection.query.q", origin: "captured-hr-value" },
  { surface: "durable/operator-xlsx-export", path: "workbook.sheetNames[]", origin: "repository-authored" },

  { surface: "file/ledger-entry", path: "payload.idempotencyKey", origin: "captured-hr-value",
    exception: "the permanent key IS the external transaction's natural identity (ref write-safety SS3); a redacted key names no transaction and the dedupe fence could not be re-derived from it." },
  { surface: "file/ledger-entry", path: "payload.proof.value", origin: "captured-hr-value",
    exception: "the schema-bound proof the external system returned is the whole content of a filed-transaction record (ref write-safety SS6). A ledger of digests proves nothing was filed. It never leaves `.tracker-rebuild/ledger/`." },

  { surface: "egress/advisory-prompt", path: "answerSchema", origin: "repository-authored" },
  { surface: "egress/advisory-prompt", path: "instruction", origin: "repository-authored" },

  { surface: "os/notification-projection", path: "summary", origin: "repository-authored" },
  { surface: "os/notification-projection", path: "title", origin: "repository-authored" },
  ]),
);

/* ── 7. module dispositions ───────────────────────────────────────────────── */

export const SURFACE_MODULE_DISPOSITIONS: readonly SurfaceModuleDisposition[] = Object.freeze(
  SurfaceModuleDispositionSchema.array().parse([
    { module: "src/domain/dashboard/actions.ts", state: "audited", reason: "the action descriptor and its confirmation copy ride the queue row" },
    { module: "src/domain/dashboard/activity.ts", state: "audited", reason: "the activity report aggregates runs into counts and durations" },
    { module: "src/domain/dashboard/advisory.ts", state: "audited", reason: "the run advisory renders a third-party model's answer back to the operator" },
    { module: "src/domain/dashboard/archive.ts", state: "audited", reason: "the archive index and detail re-serve retired runs; capture resources report exact-byte availability" },
    { module: "src/domain/dashboard/artifacts.ts", state: "audited", reason: "artifact resources point at downloadable run output" },
    { module: "src/domain/dashboard/bootstrap.ts", state: "audited", reason: "bootstrap carries the actor, the workflow registry and feature availability" },
    { module: "src/domain/dashboard/diagnostic-bundle.ts", state: "audited", reason: "D137 readback carries only verified attachment metadata and capture-time redaction facts" },
    { module: "src/domain/dashboard/explorer-edit.ts", state: "audited", reason: "D290 preserves the superseded DCC4 schema declarations only through source ancestry; no integrated durable surface or active runtime repository uses them" },
    { module: "src/domain/dashboard/explorer.ts", state: "audited", reason: "the explorer projects descriptors, contracts and the UI catalog" },
    { module: "src/domain/dashboard/primitives.ts", state: "audited", reason: "shared wire primitives are carried by the surfaces that embed them" },
    { module: "src/domain/dashboard/projection.ts", state: "audited", reason: "the queue row and day projection are the operator's main surface" },
    { module: "src/domain/dashboard/run-comparison.ts", state: "audited", reason: "D289 serves only closed-registry safe values or relation-free withheld facts" },
    { module: "src/domain/dashboard/run-detail.ts", state: "audited", reason: "run detail and its sections carry everything one run touched" },
    { module: "src/domain/dashboard/search.ts", state: "audited", reason: "cross-date search serves redacted run authority and an opaque continuation" },
    { module: "src/domain/dashboard/settings.ts", state: "audited", reason: "the read-only Settings sections state configured system hosts and descriptor-derived capabilities" },
    { module: "src/domain/dashboard/settings-editor.ts", state: "audited", reason: "the server-listed editable Settings inventory carries strict values, provenance and runtime identity" },
    { module: "src/domain/dashboard/status-vocabulary.ts", state: "audited", reason: "the closed status vocabulary is operator-visible prose and pill copy" },
    { module: "src/domain/dashboard/storage.ts", state: "audited", reason: "the storage doctor reports on backups, files and health causes" },
    { module: "src/domain/dashboard/subscription.ts", state: "audited", reason: "the stream envelope carries every live patch of the surfaces above" },
    { module: "src/domain/dashboard/xlsx-export.ts", state: "audited", reason: "the XLSX evidence retains one exact redacted query or Activity snapshot and attachment identity" },
    { module: "src/domain/intake/wire.ts", state: "audited", reason: "the mapping grid shows the operator their own uploaded file" },
    { module: "src/domain/ledger.ts", state: "audited", reason: "the ledger entry is the permanent on-disk record of a filed transaction" },
    { module: "src/domain/notification-triggers.ts", state: "audited", reason: "the trigger event and its projection become OS-delivered text" },
    { module: "src/domain/notifications.ts", state: "audited", reason: "the durable inbox row retains the delivered title and summary" },
    { module: "src/domain/trust/advisory.ts", state: "audited", reason: "the advisory prompt is the only payload that leaves this process" },
    { module: "src/domain/trust/diagnostic.ts", state: "audited", reason: "the diagnostic bundle row indexes captured attachments" },
    { module: "src/domain/trust/evidence.ts", state: "audited", reason: "the evidence receipt is the durable answer to what a run read and wrote" },
    { module: "src/domain/trust/failure.ts", state: "audited", reason: "the failure record is the durable answer to why a run stopped" },
  ]),
);

/* ── 8. the producer-side half of the `*Redacted` promise ─────────────────── */

/**
 * A `<name>Redacted` PROPERTY ASSIGNMENT anywhere in `src/` that is not a
 * schema declaration. The declaration audit can only see the shape; this sees
 * the write. Today `FailureRecord.page.urlRedacted`,
 * `page.titleRedacted` and `subject.*.displayRedacted` have NO producer at all
 * — they are declared, consumed by the run-detail wire and the advisory's
 * `drop` table, and never filled — so the first code that fills one is the code
 * this arm exists to stop: a `urlRedacted: page.url()` satisfies every schema
 * in the tree and is a raw query string on a durable record.
 */
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
