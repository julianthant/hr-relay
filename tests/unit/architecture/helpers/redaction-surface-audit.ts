/**
 * Doc 10 §3.15 / D183 — the redaction surface scan's declaration half.
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
 * `operator-loopback` is the dashboard bound to `127.0.0.1` (doc 11 §6.1) and
 * read by the single operator who is authorized to see this data — so every
 * origin is admissible there and the teeth are (a) every leaf is dispositioned
 * at all and (b) the canary sweep. The classes that actually let a value ESCAPE
 * are narrow on purpose: `process-egress` (an AI provider) admits only what
 * this repository wrote or explicitly redacted, and `os-notification` — text
 * that can render on a lock screen — admits only repository-authored strings,
 * which is exactly doc 03 §2.6's "no raw secrets or captured form contents in
 * notification text" expressed as a schema property rather than a promise.
 *
 * This module deliberately does NOT re-implement redaction, re-derive a
 * classification, or restate `no-secret-values-in-logs.test.ts` (env-sourced
 * credentials in log calls), `secrets-single-source.test.ts`,
 * `evidence-receipt.test.ts` (the receipt's own canaries and its
 * declaration-time refusals), `notification-durability.test.ts` or
 * `capture-durability-and-scope.test.ts`. It audits the SURFACES those guards
 * each look at one at a time, in one sweep, in both directions.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import { CaptureSessionWireSchema } from "../../../../src/domain/capture-surface.js";
import {
  ActionDescriptorWireSchema,
} from "../../../../src/domain/dashboard/actions.js";
import { ActivityReportWireSchema } from "../../../../src/domain/dashboard/activity.js";
import { RunAdvisoryWireSchema } from "../../../../src/domain/dashboard/advisory.js";
import {
  ArchivedRunDetailWireSchema,
  ArchiveIndexWireSchema,
  VersionBumpPlanWireSchema,
} from "../../../../src/domain/dashboard/archive.js";
import {
  ArtifactResourceWireSchema,
  CapturePointerWireSchema,
} from "../../../../src/domain/dashboard/artifacts.js";
import { FrontendBootstrapWireSchema } from "../../../../src/domain/dashboard/bootstrap.js";
import {
  UiCatalogWireSchema,
  WorkflowExplorerWireSchema,
} from "../../../../src/domain/dashboard/explorer.js";
import {
  DashboardDayWireSchema,
  QueueSurfaceWireSchema,
} from "../../../../src/domain/dashboard/projection.js";
import {
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
} from "../../../../src/domain/dashboard/run-detail.js";
import { StorageDoctorWireSchema } from "../../../../src/domain/dashboard/storage.js";
import { DashboardStreamEnvelopeSchema } from "../../../../src/domain/dashboard/subscription.js";
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
  /** Doc 12 §7's ONE non-loopback ingress: the operator's own phone. */
  "phone-scoped",
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
    "declared-redacted": "permitted",
    "local-filesystem-name": "permitted",
    "captured-hr-value": "permitted",
    "external-text": "permitted",
  },
  "phone-scoped": {
    "repository-authored": "permitted",
    "declared-redacted": "permitted",
    "local-filesystem-name": "permitted",
    "captured-hr-value": "permitted",
    "external-text": "refused",
  },
  "durable-authority": {
    "repository-authored": "permitted",
    "declared-redacted": "permitted",
    "local-filesystem-name": "permitted",
    "captured-hr-value": "permitted",
    "external-text": "exception",
  },
  "durable-file": {
    "repository-authored": "permitted",
    "declared-redacted": "permitted",
    "local-filesystem-name": "permitted",
    "captured-hr-value": "exception",
    "external-text": "refused",
  },
  "process-egress": {
    "repository-authored": "permitted",
    "declared-redacted": "permitted",
    "local-filesystem-name": "refused",
    "captured-hr-value": "refused",
    "external-text": "refused",
  },
  "os-notification": {
    "repository-authored": "permitted",
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
        + "That is doc 03 §1.1(c)'s Data rail working as designed: the operator's own loopback "
        + "surface is entitled to the values their run touched, and a digest there would answer "
        + "nothing. The NAME is the defect, not the value, and renaming a served wire field is a "
        + "doc 03 contract change with its own decision — recorded here so the next reader does "
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
  "src/domain/capture-surface.ts",
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
 * Doc 11 §6: "Tests seed canary passwords, cookies, storage state, SSNs, DOBs,
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
  { id: "wire/queue-surface", egress: "operator-loopback", module: "src/domain/dashboard/projection.ts", schema: QueueSurfaceWireSchema },
  { id: "wire/dashboard-day", egress: "operator-loopback", module: "src/domain/dashboard/projection.ts", schema: DashboardDayWireSchema },
  { id: "wire/stream-envelope", egress: "operator-loopback", module: "src/domain/dashboard/subscription.ts", schema: DashboardStreamEnvelopeSchema },
  { id: "wire/bootstrap", egress: "operator-loopback", module: "src/domain/dashboard/bootstrap.ts", schema: FrontendBootstrapWireSchema },
  { id: "wire/activity-report", egress: "operator-loopback", module: "src/domain/dashboard/activity.ts", schema: ActivityReportWireSchema },
  { id: "wire/run-advisory", egress: "operator-loopback", module: "src/domain/dashboard/advisory.ts", schema: RunAdvisoryWireSchema },
  { id: "wire/action-descriptor", egress: "operator-loopback", module: "src/domain/dashboard/actions.ts", schema: ActionDescriptorWireSchema },
  { id: "wire/artifact-resource", egress: "operator-loopback", module: "src/domain/dashboard/artifacts.ts", schema: ArtifactResourceWireSchema },
  // Declared, strict-schema-tested, and not yet served by any route. It is
  // registered anyway: a surface reviewed before it ships is the only kind that
  // cannot ship unreviewed.
  { id: "wire/capture-pointer", egress: "operator-loopback", module: "src/domain/dashboard/artifacts.ts", schema: CapturePointerWireSchema },
  { id: "wire/storage-doctor", egress: "operator-loopback", module: "src/domain/dashboard/storage.ts", schema: StorageDoctorWireSchema },
  { id: "wire/workflow-explorer", egress: "operator-loopback", module: "src/domain/dashboard/explorer.ts", schema: WorkflowExplorerWireSchema },
  { id: "wire/ui-catalog", egress: "operator-loopback", module: "src/domain/dashboard/explorer.ts", schema: UiCatalogWireSchema },
  { id: "wire/archive-index", egress: "operator-loopback", module: "src/domain/dashboard/archive.ts", schema: ArchiveIndexWireSchema },
  { id: "wire/archived-run-detail", egress: "operator-loopback", module: "src/domain/dashboard/archive.ts", schema: ArchivedRunDetailWireSchema },
  { id: "wire/version-bump-plan", egress: "operator-loopback", module: "src/domain/dashboard/archive.ts", schema: VersionBumpPlanWireSchema },
  { id: "wire/intake-session", egress: "operator-loopback", module: "src/domain/intake/wire.ts", schema: IntakeSessionWireSchema },
  { id: "wire/capture-session", egress: "phone-scoped", module: "src/domain/capture-surface.ts", schema: CaptureSessionWireSchema },
  { id: "durable/failure-record", egress: "durable-authority", module: "src/domain/trust/failure.ts", schema: FailureRecordSchema },
  { id: "durable/evidence-receipt", egress: "durable-authority", module: "src/domain/trust/evidence.ts", schema: RunEvidenceReceiptSchema },
  { id: "durable/notification-record", egress: "durable-authority", module: "src/domain/notifications.ts", schema: NotificationRecordSchema },
  { id: "durable/diagnostic-bundle", egress: "durable-authority", module: "src/domain/trust/diagnostic.ts", schema: DiagnosticBundleSchema },
  { id: "file/ledger-entry", egress: "durable-file", module: "src/domain/ledger.ts", schema: LedgerEntrySchema },
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
  { surface: "wire/run-detail", path: "timeline.events[].notRun.reason", origin: "repository-authored" },

  { surface: "wire/run-detail-section", path: "payload.artifacts[].message", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.artifacts[].reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.editing.reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.entries[].edit.pendingCorrection.value", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.entries[].edit.reason", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.entries[].edit.value", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.entries[].label", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.entries[].valueRedacted", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.members[].label", origin: "captured-hr-value" },
  { surface: "wire/run-detail-section", path: "payload.message", origin: "repository-authored" },
  { surface: "wire/run-detail-section", path: "payload.notes[].message", origin: "external-text" },
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
   * The parked-write section (doc 09 §4.1). Its served actions are the same
   * server-authored `ActionDescriptorWire` leaves already dispositioned under
   * `wire/action-descriptor`, reached one level deeper.
   *
   * `payload.parkedMessage` is `external-text` and NOT repository-authored,
   * which is the disposition that matters here: doc 09 §4's `park()` builds it
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
   * The identity-approval gate section (doc 09 §14.4, separations chunk 3).
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

  /*
   * The queue row's own served controls (doc 13 §8.5). Every leaf is authored
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
  { surface: "wire/stream-envelope", path: "payload.replacement.timeline.events[].durationMs.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.gate.reason", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.header.title", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.members[].label", origin: "captured-hr-value" },
  { surface: "wire/stream-envelope", path: "payload.message", origin: "repository-authored" },
  { surface: "wire/stream-envelope", path: "payload.note.message", origin: "external-text" },
  { surface: "wire/stream-envelope", path: "payload.notes[].message", origin: "external-text" },
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
  // `workflows[].code` needs no row: it is regex-constrained to two chars at
  // the wire boundary, so the scan does not read it as a free-text leaf.
  { surface: "wire/bootstrap", path: "workflows[].label", origin: "repository-authored" },

  { surface: "wire/activity-report", path: "categories[].category.reason", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "durations.longestMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "durations.medianMs.reason", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "workflows[].registration.label", origin: "repository-authored" },
  { surface: "wire/activity-report", path: "workflows[].registration.reason", origin: "repository-authored" },

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
  { surface: "wire/storage-doctor", path: "restoreCandidates[].backupFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor", path: "restoreCandidates[].cause.code", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "restoreCandidates[].cause.summary", origin: "external-text" },
  { surface: "wire/storage-doctor", path: "restoreCandidates[].generationGap.reason", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "restoreCandidates[].manifestFileName", origin: "local-filesystem-name" },
  { surface: "wire/storage-doctor", path: "service.message", origin: "repository-authored" },
  { surface: "wire/storage-doctor", path: "service.reason", origin: "repository-authored" },

  { surface: "wire/workflow-explorer", path: "workflows[].actions[]", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].category", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].code", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].edges[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].enqueue", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].icon", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].inputSubject.value", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].coveragePoints[].detail", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].coveragePoints[].id", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].details[].key", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].details[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].editableFields[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.branches[].id", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.cases[].name", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.edgeId", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].shape.statusKey", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].nodes[].tasks[].binding.note", origin: "repository-authored" },
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
  { surface: "wire/workflow-explorer", path: "workflows[].surfaces.captureIntake.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].surfaces.inputRun.placeholder", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].surfaces.intake.reason", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].systems[]", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].verdicts[].key", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].verdicts[].label", origin: "repository-authored" },
  { surface: "wire/workflow-explorer", path: "workflows[].verdicts[].tone", origin: "repository-authored" },

  { surface: "wire/ui-catalog", path: "entries[].label", origin: "repository-authored" },
  { surface: "wire/ui-catalog", path: "entries[].searchTerms[]", origin: "repository-authored" },

  { surface: "wire/archive-index", path: "entries[].appVersion.reason", origin: "repository-authored" },
  { surface: "wire/archive-index", path: "entries[].endedAt.reason", origin: "repository-authored" },
  { surface: "wire/archive-index", path: "entries[].title", origin: "captured-hr-value" },
  { surface: "wire/archive-index", path: "entries[].workflowLabel", origin: "repository-authored" },
  { surface: "wire/archive-index", path: "plans[].blockers[].title", origin: "captured-hr-value" },
  { surface: "wire/archive-index", path: "plans[].candidates[].title", origin: "captured-hr-value" },
  { surface: "wire/archive-index", path: "versionState[].blockers[].title", origin: "captured-hr-value" },
  { surface: "wire/archive-index", path: "versionState[].workflowLabel", origin: "repository-authored" },

  { surface: "wire/archived-run-detail", path: "appVersion.reason", origin: "repository-authored" },
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

  { surface: "wire/version-bump-plan", path: "blockers[].title", origin: "captured-hr-value" },
  { surface: "wire/version-bump-plan", path: "candidates[].title", origin: "captured-hr-value" },

  { surface: "wire/intake-session", path: "columns[].header", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "columns[].normalizedHeader", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "columns[].samples[]", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "constants[].value", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "corrections[].correctedValue", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "exclusions[].reason", origin: "repository-authored" },
  { surface: "wire/intake-session", path: "headerCandidates[].cells[]", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "rerun.diff.changes[].now", origin: "captured-hr-value" },
  { surface: "wire/intake-session", path: "rerun.diff.changes[].was", origin: "captured-hr-value" },
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

  { surface: "wire/capture-session", path: "contextHint", origin: "captured-hr-value" },
  { surface: "wire/capture-session", path: "formType", origin: "captured-hr-value" },
  { surface: "wire/capture-session", path: "handoff.message", origin: "repository-authored" },

  { surface: "durable/failure-record", path: "causeChain[].summary", origin: "external-text",
    exception: "each cause's own thrown message, same reason as `summary` and dropped by the same advisory declaration." },
  { surface: "durable/failure-record", path: "page.titleRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "page.urlRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "remediation[].message", origin: "external-text",
    exception: "composed beside a closed `kind`, but it may quote the thrown message, so it is held to the untrusted class rather than assumed authored." },
  { surface: "durable/failure-record", path: "subject.expected.displayRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "subject.observed.displayRedacted", origin: "declared-redacted" },
  { surface: "durable/failure-record", path: "summary", origin: "external-text",
    exception: "doc 12 SS2.1 / D142: `error.message` verbatim is what tells the operator WHY, and the charter requires a thrown message to name the offending value. It is durable and operator-visible on purpose; the advisory drops it (advisory.ts `withheld`) precisely because that surface leaves the machine." },

  { surface: "durable/evidence-receipt", path: "decisions[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "input[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "observations[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "output[].reason", origin: "repository-authored" },
  { surface: "durable/evidence-receipt", path: "warnings[].summary", origin: "external-text",
    exception: "src/core/evidence-receipt.ts copies `failure.summary` into the uncertainty warning; the receipt inherits the failure record's exception, not a second one." },

  { surface: "durable/notification-record", path: "summary", origin: "repository-authored" },
  { surface: "durable/notification-record", path: "title", origin: "repository-authored" },

  { surface: "durable/diagnostic-bundle", path: "redaction.warnings[]", origin: "repository-authored" },

  { surface: "file/ledger-entry", path: "payload.idempotencyKey", origin: "captured-hr-value",
    exception: "the permanent key IS the external transaction's natural identity (doc 09 SS3); a redacted key names no transaction and the dedupe fence could not be re-derived from it." },
  { surface: "file/ledger-entry", path: "payload.proof.value", origin: "captured-hr-value",
    exception: "the schema-bound proof the external system returned is the whole content of a filed-transaction record (doc 09 SS6). A ledger of digests proves nothing was filed. It never leaves `.tracker-rebuild/ledger/`." },

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
    { module: "src/domain/dashboard/archive.ts", state: "audited", reason: "the archive index and archived run detail re-serve retired runs" },
    { module: "src/domain/dashboard/artifacts.ts", state: "audited", reason: "artifact resources point at downloadable run output" },
    { module: "src/domain/dashboard/bootstrap.ts", state: "audited", reason: "bootstrap carries the actor, the workflow registry and feature availability" },
    { module: "src/domain/dashboard/explorer.ts", state: "audited", reason: "the explorer projects descriptors, contracts and the UI catalog" },
    { module: "src/domain/dashboard/primitives.ts", state: "audited", reason: "shared wire primitives are carried by the surfaces that embed them" },
    { module: "src/domain/dashboard/projection.ts", state: "audited", reason: "the queue row and day projection are the operator's main surface" },
    { module: "src/domain/dashboard/run-detail.ts", state: "audited", reason: "run detail and its sections carry everything one run touched" },
    { module: "src/domain/dashboard/storage.ts", state: "audited", reason: "the storage doctor reports on backups, files and health causes" },
    { module: "src/domain/dashboard/subscription.ts", state: "audited", reason: "the stream envelope carries every live patch of the surfaces above" },
    { module: "src/domain/capture-surface.ts", state: "audited", reason: "doc 12 SS7's phone capture page is the one non-loopback surface" },
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
