import { MAXIMAL_FAILURE } from "../../support/fixtures/advisory-prompt-fixtures.js";
import { historicalArchiveAuthority } from "../../support/helpers/integration/historical-archive-authority.js";
import { sqliteRunReader } from "../../support/helpers/canonical-run-reader.js";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, it, vi } from "vitest";
import { z } from "zod";
import { ArchivedRunContentSchema, ArchivedRunRecordSchema, archivedRunContentDigest } from "../../../src/models/archive/model.js";
import { ArchivedCaptureResourceWireSchema, type ArchivedCaptureResourceWire } from "../../../src/models/dashboard/archive.js";
import type { ArtifactRef } from "../../../src/models/artifacts/artifacts.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { ExplorerPresentationLabelSchema } from "../../../src/models/dashboard/explorer.js";
import { AtomicOutboxRecordSchema } from "../../../src/models/notifications/outbox.js";
import { SpanAuthorityReconciliationWireSchema } from "../../../src/models/dashboard/storage.js";
import { redactDiagnosticFields, redactValue } from "../../../src/rules/redaction/redaction.js";
import { NotificationTriggerEventSchema, projectNotificationTrigger } from "../../../src/rules/notifications/notification-triggers.js";
import { FailureRecordSchema } from "../../../src/models/trust/failure.js";
import { buildRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { LedgerEntrySchema } from "../../../src/rules/runs/ledger.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { VerifiedArtifactSourceMissingError, type ServerVerifiedArtifactReader } from "../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { buildArchivedCaptureResource } from "../../../src/backend/runs/queries/archive.js";
import { ArtifactBytesCorruptError, IndexedArtifactBytesMissingError } from "../../../src/backend/runs/queries/artifact-bytes.js";
import { ARCHIVED_RUN_WITH_SECTIONS, VERSION_BUMP_APPLICATION, VERSION_PLAN_ROW } from "../../support/fixtures/archive-fixtures.js";
import { personLookupQueuedRun } from "../../support/helpers/phase1f-executor-harness.js";
import { LEDGER_OUTBOX_PAYLOAD, NOW, UUID_1, UUID_6 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { EXIT_RUN_ID, seedPersonLookupExitRun } from "../../support/fixtures/receipt-run-fixtures.js";
import { REPO_ROOT } from "../support/helpers/guard-files.js";
import { ALL_CANARY_NAMES, auditD331ServedLeafDispositions, auditRedactedProducers, auditSurfaceOrigins, canariesIn, decidableLeaves, D331_SERVED_LEAF_DISPOSITIONS, REDACTED_NAME_WAIVERS, REDACTION_CANARIES, REDACTION_SURFACES, redactedProducerSites, SURFACE_LEAF_ORIGINS, SURFACE_MODULE_DISPOSITIONS, scannedSurfaceModules, surfaceLeaves, UNIVERSAL_CANARY_NAMES, type RedactionSurface, type SurfaceLeafOrigin } from "./helpers/redaction-surface-audit.js";
import { personLookupDescriptor } from "../../support/helpers/registered-workflows.js";

/* ── the modules whose exported wire schemas must be covered ─────────────── */

const WIRE_SCHEMA_MODULES = [
  "../../../src/models/dashboard/actions.js",
  "../../../src/models/dashboard/activity.js",
  "../../../src/models/dashboard/archive.js",
  "../../../src/models/dashboard/artifacts.js",
  "../../../src/models/dashboard/bootstrap.js",
  "../../../src/models/dashboard/diagnostic-bundle.js",
  "../../../src/models/dashboard/explorer.js",
  "../../../src/models/dashboard/primitives.js",
  "../../../src/models/dashboard/projection.js",
  "../../../src/models/dashboard/run-detail.js",
  "../../../src/models/dashboard/start-plan.js",
  "../../../src/models/dashboard/storage.js",
  "../../../src/models/dashboard/subscription.js",
  "../../../src/models/intake/wire.js",
  "../../../src/models/trust/failure.js",
] as const;

/** `a.b[].c` is covered by `payload.a.b[].c`; a bare name is covered by `x.name`. */
function pathCoveredBy(candidate: string, owned: readonly string[]): boolean {
  return owned.some((path) => path === candidate || path.endsWith(`.${candidate}`));
}

/* ── (a) the declaration audit ───────────────────────────────────────────── */

describe("redaction surface scan — the declaration audit", () => {
  it("refuses every universal credential/regulated-value canary as an operator-authored Explorer label", () => {
    for (const name of UNIVERSAL_CANARY_NAMES) {
      assert.equal(
        ExplorerPresentationLabelSchema.safeParse(REDACTION_CANARIES[name]).success,
        false,
        name,
      );
    }
  });

  it("dispositions every free-text and open-JSON leaf of every registered surface", () => {
    const violations = auditSurfaceOrigins(REDACTION_SURFACES, SURFACE_LEAF_ORIGINS);
    assert.deepEqual(violations, [], `redaction surface audit:\n  ${violations.join("\n  ")}`);
  });

  it("dispositions every served settings leaf as closed-literal or identifier-free", () => {
    const violations = auditD331ServedLeafDispositions(D331_SERVED_LEAF_DISPOSITIONS);
    assert.deepEqual(violations, [], `served-settings disposition audit:\n  ${violations.join("\n  ")}`);
  });

  it("makes an omitted leaf, a wrong class, and an unreviewed class red", () => {
    const omitted = D331_SERVED_LEAF_DISPOSITIONS.filter((entry) =>
      entry.surface !== "protected-settings-readback" || entry.path !== "entries.ucpathPassword.valueId");
    assert.equal(omitted.length, D331_SERVED_LEAF_DISPOSITIONS.length - 1);
    assert.deepEqual(auditD331ServedLeafDispositions(omitted), [
      "protected-settings-readback|entries.ucpathPassword.valueId: carries no served-settings disposition "
      + "(ProtectedSettingsNameSchema × ProtectedSettingsPresenceSchema)",
    ]);

    const wrongClass = D331_SERVED_LEAF_DISPOSITIONS.map((entry) => entry.surface === "host-display"
      && entry.path === "display.screenWidth.effectiveValue"
      ? { ...entry, valueClass: "closed-literal" as const }
      : entry);
    assert.deepEqual(auditD331ServedLeafDispositions(wrongClass), [
      "host-display|display.screenWidth.effectiveValue: closed-literal contradicts identifier-free "
      + "(EditableSettingsWireSchema effectiveValue is the active resolved display fact)",
    ]);

    const unreviewedClass = D331_SERVED_LEAF_DISPOSITIONS.map((entry) => entry.surface === "frontend-bootstrap"
      ? { ...entry, valueClass: "captured-value" }
      : entry);
    const unreviewedViolations = auditD331ServedLeafDispositions(unreviewedClass);
    assert.ok(unreviewedViolations.some((violation) => violation.includes("settings disposition row")));
    assert.ok(unreviewedViolations.some((violation) =>
      violation.includes("frontend-bootstrap|protectedSchemaHash: carries no served-settings disposition")));
  });

  it("refuses every independently omitted doctor leaf", () => {
    const doctor = D331_SERVED_LEAF_DISPOSITIONS.filter(({ surface }) => surface === "protected-settings-doctor");
    assert.equal(doctor.length, 5);
    for (const omitted of doctor) {
      const remaining = D331_SERVED_LEAF_DISPOSITIONS.filter((entry) => entry !== omitted);
      const violations = auditD331ServedLeafDispositions(remaining);
      assert.equal(violations.length, 1);
      assert.ok(violations[0]?.includes(`protected-settings-doctor|${omitted.path}: carries no`));
    }
  });

  it("audits a real surface rather than an empty set", () => {

    assert.ok(REDACTION_SURFACES.length >= 20, "the surface registry collapsed");
    assert.ok(SURFACE_LEAF_ORIGINS.length >= 200, "the disposition table collapsed");
    const audited = REDACTION_SURFACES.flatMap((surface) => decidableLeaves(surface.schema));
    assert.ok(audited.length >= 200, "the audit walked almost no leaves");
    const egressClasses = new Set(REDACTION_SURFACES.map(({ egress }) => egress));
    assert.deepEqual([...egressClasses].sort(), ["durable-authority", "durable-file", "operator-loopback", "os-notification"], "every remaining egress class must have at least one registered surface");
  });

  it("retains full supplied person identifiers in span/authority diagnostic messages", () => {
    const canonicalEid = "10873698";
    const sensitiveDetail = {
      state: "degraded",
      streamRunCount: 1,
      liveRunCount: 0,
      archived: [],
      deleted: [],
      problems: [{
        state: "malformed",
        runId: "11111111-1111-4111-8111-111111111111",
        table: "span_stream",
        summary: `span root contained EID ${canonicalEid}`,
      }],
    };
    assert.equal(SpanAuthorityReconciliationWireSchema.safeParse({
      ...sensitiveDetail,
      problems: sensitiveDetail.problems.map((problem) => ({ ...problem, summary: "span root has a malformed identity" })),
    }).success, true, "the control must be a valid rich span_stream wire arm");
    assert.deepEqual(SpanAuthorityReconciliationWireSchema.parse(sensitiveDetail), sensitiveDetail);
    assert.equal(SpanAuthorityReconciliationWireSchema.safeParse({
      state: "unavailable",
      cause: { code: "span-authority-unavailable", summary: "authority lookup failed strict validation" },
    }).success, true);
    assert.equal(SpanAuthorityReconciliationWireSchema.safeParse({
      state: "unavailable",
      cause: { code: "span-authority-unavailable", summary: `authority lookup failed for EID ${canonicalEid}` },
    }).success, true);
    assert.equal(SpanAuthorityReconciliationWireSchema.safeParse({state:"unavailable",cause:{code:"span-authority-unavailable",summary:""}}).success,false);
    assert.equal(SpanAuthorityReconciliationWireSchema.safeParse({...sensitiveDetail,undeclared:"not admitted"}).success,false);
  });

  it("registers the complete archived capture resource with exactly its three authored leaves", () => {
    const surfaces = REDACTION_SURFACES.filter(({ id }) => id === "wire/archived-capture-resource");
    assert.equal(surfaces.length, 1);
    assert.deepEqual(surfaces[0], {
      id: "wire/archived-capture-resource",
      egress: "operator-loopback",
      module: "src/models/dashboard/archive.ts",
      schema: ArchivedCaptureResourceWireSchema,
    });
    assert.deepEqual(surfaceLeaves(ArchivedCaptureResourceWireSchema), [
      { path: "artifactId", kind: "closed" },
      { path: "resource.downloadUrl", kind: "free-text" },
      { path: "resource.message", kind: "free-text" },
      { path: "resource.reason", kind: "free-text" },
      { path: "resource.state", kind: "closed" },
      { path: "runId", kind: "closed" },
    ]);
    assert.deepEqual(SURFACE_LEAF_ORIGINS.filter(({ surface }) => surface === "wire/archived-capture-resource"), [
      { surface: "wire/archived-capture-resource", path: "resource.downloadUrl", origin: "repository-authored" },
      { surface: "wire/archived-capture-resource", path: "resource.message", origin: "repository-authored" },
      { surface: "wire/archived-capture-resource", path: "resource.reason", origin: "repository-authored" },
    ]);
  });

  for (const omitted of ["resource.downloadUrl", "resource.message", "resource.reason"]) {
    it(`refuses the independently omitted archived capture origin ${omitted}`, () => {
      const origins = SURFACE_LEAF_ORIGINS.filter(({ surface, path }) =>
        surface !== "wire/archived-capture-resource" || path !== omitted);
      assert.equal(origins.length, SURFACE_LEAF_ORIGINS.length - 1, "the negative must actually omit one origin");
      const violations = auditSurfaceOrigins(REDACTION_SURFACES, origins);
      assert.equal(violations.length, 1);
      const violation = violations[0];
      assert.ok(violation);
      assert.ok(violation.includes(`wire/archived-capture-resource (operator-loopback) leaf "${omitted}"`));
      assert.match(violation, /carries no declared origin/u);
    });
  }

  it("holds exact membership for current operation, action, display and notification leaves", () => {
    const currentLeaves = [
      "wire/operation-source|structure.definition.invocations[].label",
      "wire/run-detail-section|payload.confirmedActions[].action.value.consumed.value",
      "wire/run-detail-section|payload.confirmedActions[].durableProof.checkpointNodeId",
      "wire/run-detail-section|payload.confirmedActions[].durableProof.writeIntentId",
      "wire/run-detail-section|payload.confirmedActions[].eventId",
      "wire/run-detail-section|payload.confirmedActions[].proof.verifier.value.consumed.value",
      "wire/run-detail-section|payload.confirmedActions[].reason",
      "wire/run-detail-section|payload.confirmedActions[].stepOccurrence",
      "wire/run-detail-section|payload.confirmedActions[].workerStreamId",
      "wire/run-detail-section|payload.operationStructure.definition.invocations[].label",
      "wire/run-detail-section|payload.value.display.observation",
      "wire/run-detail-section|payload.value.display.title",
      "wire/dashboard-day|notifications[].context.subject",
      "wire/dashboard-day|notifications[].context.workflow",
      "wire/stream-envelope|payload.confirmedActions[].action.value.consumed.value",
      "wire/stream-envelope|payload.confirmedActions[].durableProof.checkpointNodeId",
      "wire/stream-envelope|payload.confirmedActions[].durableProof.writeIntentId",
      "wire/stream-envelope|payload.confirmedActions[].eventId",
      "wire/stream-envelope|payload.confirmedActions[].proof.verifier.value.consumed.value",
      "wire/stream-envelope|payload.confirmedActions[].reason",
      "wire/stream-envelope|payload.confirmedActions[].stepOccurrence",
      "wire/stream-envelope|payload.confirmedActions[].workerStreamId",
      "wire/stream-envelope|payload.notifications[].context.subject",
      "wire/stream-envelope|payload.notifications[].context.workflow",
      "wire/stream-envelope|payload.operationStructure.definition.invocations[].label",
      "wire/workflow-explorer|workflows[].definitionPreview.groups[].key",
      "wire/workflow-explorer|workflows[].definitionPreview.groups[].label",
      "wire/workflow-explorer|workflows[].definitionPreview.reason",
      "wire/workflow-explorer|workflows[].operationStructure.definition.invocations[].label",
      "wire/archived-run-detail|failure.value.display.observation",
      "wire/archived-run-detail|failure.value.display.title",
      "wire/archived-run-detail|sections.value.logs.value.confirmedActions[].action.value.consumed.value",
      "wire/archived-run-detail|sections.value.logs.value.confirmedActions[].durableProof.checkpointNodeId",
      "wire/archived-run-detail|sections.value.logs.value.confirmedActions[].durableProof.writeIntentId",
      "wire/archived-run-detail|sections.value.logs.value.confirmedActions[].eventId",
      "wire/archived-run-detail|sections.value.logs.value.confirmedActions[].proof.verifier.value.consumed.value",
      "wire/archived-run-detail|sections.value.logs.value.confirmedActions[].reason",
      "wire/archived-run-detail|sections.value.logs.value.confirmedActions[].stepOccurrence",
      "wire/archived-run-detail|sections.value.logs.value.confirmedActions[].workerStreamId",
      "wire/archived-run-detail|sections.value.logs.value.operationStructure.definition.invocations[].label",
    ];
    assert.equal(new Set(currentLeaves).size, currentLeaves.length);
    for (const identity of currentLeaves) {
      const remaining = SURFACE_LEAF_ORIGINS.filter(entry => `${entry.surface}|${entry.path}` !== identity);
      assert.equal(remaining.length, SURFACE_LEAF_ORIGINS.length - 1, identity);
      const violations = auditSurfaceOrigins(REDACTION_SURFACES, remaining);
      assert.equal(violations.length, 1, identity);
      assert.match(violations[0] ?? "", /carries no declared origin/u);
    }
  });

  it("registers every surface-bearing module in both directions", () => {
    const scanned = scannedSurfaceModules();
    const declared = SURFACE_MODULE_DISPOSITIONS.map(({ module }) => module).sort();
    assert.deepEqual(
      declared,
      [...scanned].sort(),
      "every module that can declare a wire or durable surface needs a disposition; a new file "
      + "under src/models/dashboard (or a new entry in EXTRA_SURFACE_MODULES) is a whole surface "
      + "nobody reviewed",
    );
    for (const surface of REDACTION_SURFACES) {
      assert.ok(
        scanned.includes(surface.module),
        `${surface.id} names module ${surface.module}, which is outside the scanned set`,
      );
    }
  });

  it("covers every exported *WireSchema by a registered surface", async () => {

    const owned = REDACTION_SURFACES.flatMap((surface) => surfaceLeaves(surface.schema).map(({ path }) => path));
    const registered = new Set(REDACTION_SURFACES.map(({ schema }) => schema));
    const uncovered: string[] = [];
    for (const specifier of WIRE_SCHEMA_MODULES) {
      const module = await (import(specifier) as Promise<Readonly<Record<string, unknown>>>);
      const relativeModule = `src/${specifier.split("/src/")[1] ?? ""}`.replace(/\.js$/, ".ts");
      for (const [name, value] of Object.entries(module)) {
        if (!name.endsWith("WireSchema") || !(value instanceof z.ZodType)) continue;
        if (registered.has(value)) continue;
        const paths = surfaceLeaves(value).map(({ path }) => path);
        // Root-only schemas declare no field; their embedding surfaces audit the leaf.
        if (paths.length === 1 && paths[0] === "") continue;
        const missing = paths.filter((path) => !pathCoveredBy(path, owned));
        if (missing.length > 0) {
          uncovered.push(`${relativeModule} ${name}: leaves not carried by any registered surface — ${missing.join(", ")}`);
        }
      }
    }
    assert.deepEqual(
      uncovered,
      [],
      `an exported wire schema escaped the audit:\n  ${uncovered.join("\n  ")}`,
    );
  });

  it("refuses an undispositioned leaf, a refused origin, and a missing exception", () => {

    const leakyWire = z.strictObject({ ok: z.enum(["yes", "no"]), note: z.string().min(1) });
    const loopback: RedactionSurface = {
      id: "fixture/loopback",
      egress: "operator-loopback",
      module: "src/models/dashboard/run-detail.ts",
      schema: leakyWire,
    };
    const toast: RedactionSurface = {
      id: "fixture/toast",
      egress: "os-notification",
      module: "src/rules/notifications/notification-triggers.ts",
      schema: leakyWire,
    };
    const durable: RedactionSurface = {
      id: "fixture/durable",
      egress: "durable-authority",
      module: "src/models/trust/failure.ts",
      schema: leakyWire,
    };
    const declare = (surface: string, origin: SurfaceLeafOrigin["origin"], exception?: string): SurfaceLeafOrigin[] => [
      exception === undefined
        ? { surface, path: "note", origin }
        : { surface, path: "note", origin, exception },
    ];

    const undispositioned = auditSurfaceOrigins([loopback], []);
    assert.equal(undispositioned.length, 1, "an undispositioned free-text leaf must fail");
    assert.match(undispositioned[0] ?? "", /carries no declared origin/);

    const refused = auditSurfaceOrigins([toast], declare("fixture/toast", "captured-hr-value"));
    assert.equal(refused.length, 1, "a captured HR value on an OS toast must fail");
    assert.match(refused[0] ?? "", /may not carry at all/);

    const unexcepted = auditSurfaceOrigins([durable], declare("fixture/durable", "external-text"));
    assert.equal(unexcepted.length, 1, "durable external text must name the decision that admits it");
    assert.match(unexcepted[0] ?? "", /needs a written exception/);

    const excused = auditSurfaceOrigins(
      [durable],
      declare("fixture/durable", "external-text", "the exit-run fixture's thrown message, retained by D142 so the operator can see why"),
    );
    assert.deepEqual(excused, [], "a written exception admits the origin");

    const gratuitous = auditSurfaceOrigins(
      [loopback],
      declare("fixture/loopback", "repository-authored", "an exception nobody needed, which is how the real ones stop being read"),
    );
    assert.equal(gratuitous.length, 1, "an unnecessary exception must fail");

    const stale = auditSurfaceOrigins([loopback], [
      { surface: "fixture/loopback", path: "note", origin: "repository-authored" },
      { surface: "fixture/loopback", path: "gone", origin: "repository-authored" },
    ]);
    assert.equal(stale.length, 1, "a disposition for a leaf the surface no longer carries must fail");
    assert.match(stale[0] ?? "", /no longer carries/);

    const orphan = auditSurfaceOrigins([loopback], [
      { surface: "fixture/loopback", path: "note", origin: "repository-authored" },
      { surface: "fixture/absent", path: "note", origin: "repository-authored" },
    ]);
    assert.equal(orphan.length, 1, "a disposition naming no registered surface must fail");

    const closedOnly = auditSurfaceOrigins([{
      ...loopback,
      schema: z.strictObject({ ok: z.enum(["yes", "no"]), count: z.number().int() }),
    }], []);
    assert.deepEqual(closedOnly, [], "a surface of closed leaves needs no disposition at all");
  });

  it("holds a *Redacted field name to what its producer actually does", () => {

    const sites = redactedProducerSites(join(REPO_ROOT, "src"));
    const violations = auditRedactedProducers(sites);
    assert.deepEqual(violations, [], `unredacted *Redacted writes:\n  ${violations.join("\n  ")}`);
    assert.ok(
      sites.some(({ field }) => field === "valueRedacted"),
      "the scan must still be finding the sites it waives; a scanner that matched nothing would be "
      + "green for the wrong reason",
    );
    for (const waiver of REDACTED_NAME_WAIVERS) {
      assert.ok(
        sites.some(({ field }) => field === waiver.field),
        `${waiver.field} is waived but no longer written anywhere; drop the waiver`,
      );
    }
  });

  it("fires on a producer that fills a *Redacted field with a raw value", () => {
    // The negative control, executed through the guard's own entry point over a
    // fixture that violates exactly this arm.
    const root = mkdtempSync(join(tmpdir(), "hrauto-redaction-fixture-"));
    roots.push(root);
    writeFileSync(join(root, "leaky-producer.ts"), [
      "export function failurePage(page: { url(): string; title(): string }) {",
      "  return {",
      "    urlRedacted: page.url(),",
      "    titleRedacted: page.title(),",
      "  };",
      "}",
      "",
    ].join("\n"));
    const violations = auditRedactedProducers(redactedProducerSites(root));
    assert.equal(violations.length, 2, "both raw writes must be reported");
    assert.match(violations[0] ?? "", /writes urlRedacted without a declared redaction/);

    writeFileSync(join(root, "leaky-producer.ts"), [
      "import { z } from \"zod\";",
      "export const PageSchema = z.strictObject({ urlRedacted: z.string().min(1) });",
      "",
    ].join("\n"));
    assert.deepEqual(
      auditRedactedProducers(redactedProducerSites(root)),
      [],
      "a zod declaration of the same field is not a producer",
    );
  });

  it("reads a redacted value as self-describing wherever it is embedded", () => {

    const receipt = REDACTION_SURFACES.find(({ id }) => id === "durable/evidence-receipt");
    assert.ok(receipt !== undefined);
    const kinds = surfaceLeaves(receipt.schema);
    assert.ok(
      kinds.some(({ path, kind }) => path === "input[].value" && kind === "declared-redacted"),
      "an embedded RedactedField must be read as declared-redacted, not decomposed",
    );

    const decoy = z.strictObject({
      value: z.strictObject({ state: z.string(), classification: z.string(), value: z.string() }),
    });
    assert.deepEqual(
      decidableLeaves(decoy).map(({ path }) => path),
      ["value.classification", "value.state", "value.value"],
      "a shape that merely resembles a redacted arm (no `transform`) must NOT be trusted",
    );
  });
});

/* ── (b) the canary sweep ────────────────────────────────────────────────── */

const CANARY_FAILURE = FailureRecordSchema.parse({
  ...MAXIMAL_FAILURE,
  summary: `search failed for ${REDACTION_CANARIES.personName} (SSN ${REDACTION_CANARIES.ssn}, DOB ${REDACTION_CANARIES.dob})`,
  subject: {
    expected: {
      ...MAXIMAL_FAILURE.subject?.expected,
      displayRedacted: `EID ${REDACTION_CANARIES.emplId}`,
    },
    observed: {
      ...MAXIMAL_FAILURE.subject?.observed,
      displayRedacted: REDACTION_CANARIES.personName,
    },
    proofRef: MAXIMAL_FAILURE.subject?.proofRef,
  },
  page: {
    ...MAXIMAL_FAILURE.page,
    urlRedacted: `https://crm.ucsd.edu/search?ssn=${REDACTION_CANARIES.ssn}&${REDACTION_CANARIES.cookie}`,
    titleRedacted: `Results — ${REDACTION_CANARIES.personName}`,
  },
  causeChain: [
    {
      code: "SUBJECT_MISMATCH",
      summary: `expected ${REDACTION_CANARIES.personName} but read ${REDACTION_CANARIES.storageState}`,
      role: "primary",
      transient: false,
    },
    {
      code: "STALE_SESSION",
      summary: `the session cookie ${REDACTION_CANARIES.cookie} had expired`,
      role: "secondary",
      transient: true,
    },
  ],
  remediation: [
    { kind: "operator-action", message: `re-read ${REDACTION_CANARIES.credentialPath} and confirm ${REDACTION_CANARIES.personName}` },
    { kind: "configuration", message: `the key ${REDACTION_CANARIES.privateKey} did not load` },
  ],
});

/** Every trigger arm, with a valid value for each of its closed leaves. */
const TRIGGER_EVENTS: readonly Record<string, unknown>[] = [
  {
    kind: "run-failed",
    runId: MAXIMAL_FAILURE.runId,
    workflowId: "person-lookup",
    failureId: MAXIMAL_FAILURE.failureId,
    failureFingerprint: MAXIMAL_FAILURE.fingerprint,
    code: "SUBJECT_MISMATCH",
  },
  {
    kind: "subject-mismatch",
    runId: MAXIMAL_FAILURE.runId,
    workflowId: "person-lookup",
    failureId: MAXIMAL_FAILURE.failureId,
    failureFingerprint: MAXIMAL_FAILURE.fingerprint,
  },
  { kind: "gate-opened", runId: MAXIMAL_FAILURE.runId, workflowId: "person-lookup", gateId: "confirm-person" },
  { kind: "write-parked", runId: MAXIMAL_FAILURE.runId, workflowId: "person-lookup", writeIntentId: UUID_1 },
  {
    kind: "repeating-failure",
    runId: MAXIMAL_FAILURE.runId,
    workflowId: "person-lookup",
    failureId: MAXIMAL_FAILURE.failureId,
    failureFingerprint: MAXIMAL_FAILURE.fingerprint,
    occurrences: 5,
    threshold: 3,
  },
  { kind: "storage-degraded", concern: "backup", state: "degraded", diagnosticFingerprint: "ab".repeat(32) },
  { kind: "verified-done", runId: MAXIMAL_FAILURE.runId, workflowId: "person-lookup" },
];

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function openDatabase(historical = false): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-redaction-scan-"));
  roots.push(root);
  const database = historical ? historicalArchiveAuthority(join(root, "authority.sqlite"), manualClock(new Date(NOW))) : AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW)),
  );
  databases.push(database);
  return database;
}

const ARCHIVE_ARTIFACT_ID = "00000000-0000-4000-8000-000000000917";
const ARCHIVE_DOWNLOAD_URL = "/artifacts/v1/archive/99999999-0009-4000-8000-999900000009/00000000-0000-4000-8000-000000000917";
const ARCHIVE_CANARY_TEXT = Object.values(REDACTION_CANARIES).join("\n");

function seedCanaryArchive() {
  const bytes = new TextEncoder().encode(ARCHIVE_CANARY_TEXT);
  assert.deepEqual(canariesIn(new TextDecoder().decode(bytes)), ALL_CANARY_NAMES, "all nine canaries must reach storage");
  const { contentDigest: _digest, ...stored } = ARCHIVED_RUN_WITH_SECTIONS;
  assert.ok(stored.sections);
  const content = ArchivedRunContentSchema.parse({
    ...stored,
    row: { ...stored.row, title: ARCHIVE_CANARY_TEXT },
    sections: {
      ...stored.sections,
      captures: { state: "present", value: [{
        artifactId: ARCHIVE_ARTIFACT_ID, bundleId: UUID_6, kind: "screenshot", mediaType: "image/png",
        byteLength: bytes.byteLength, digest: createHash("sha256").update(bytes).digest("hex"),
        sensitivity: "redacted", capturedAt: NOW, origin: "operator-request",
        dimensions: { width: 200, height: 100 },
        step: { state: "absent", reason: ARCHIVE_CANARY_TEXT },
        system: { state: "absent", reason: ARCHIVE_CANARY_TEXT },
        retention: { kind: "ordinary", purgeAfter: "2020-01-01T00:00:00.000Z" },
      }] },
    },
  });
  const record = ArchivedRunRecordSchema.parse({ ...content, contentDigest: archivedRunContentDigest(content) });
  const database = openDatabase(true);
  database.withAuthorityTransaction((repositories) => {
    repositories.runs.enqueue({ ...personLookupQueuedRun({ runId: record.runId }), input: record.input });
    repositories.runs.transition({ runId: record.runId, expectedVersion: 1, now: record.archivedAt,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: record.archivedAt } });
    repositories.versionPlans.insert(VERSION_PLAN_ROW);
    repositories.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
    repositories.archivedRuns.insert(record);
  });
  const persisted = database.authority.archivedRuns.get(record.runId);
  assert.ok(persisted);
  assert.deepEqual(persisted, record, "the real archived repository must retain the sealed source");
  assert.deepEqual(canariesIn(persisted.row.title), ALL_CANARY_NAMES, "the stored archive must carry every sentinel");
  return {
    database, record, bytes,
    ref: { id: ARCHIVE_ARTIFACT_ID, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength, mediaType: "image/png" },
  };
}

function assertNoArchiveResourceCanaries(resource: ArchivedCaptureResourceWire): void {
  assert.deepEqual(canariesIn(canonicalJsonStringify(resource)), [], "archived capture resource leaked canaries");
}

function canaryArtifactReader(
  open: (ref: ArtifactRef) => Promise<Readable>,
): ServerVerifiedArtifactReader {
  return Object.freeze({
    async verify(ref: ArtifactRef) {
      let stream: Readable;
      try {
        stream = await open(ref);
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          throw new VerifiedArtifactSourceMissingError({ cause: error });
        }
        throw error;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        if (!(chunk instanceof Uint8Array)) throw new Error("canary artifact reader received a non-byte chunk");
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.byteLength !== ref.bytes || createHash("sha256").update(bytes).digest("hex") !== ref.sha256) {
        throw new ArtifactBytesCorruptError("canary artifact bytes did not match their frozen ref");
      }
    },
    async prepare() {
      throw new Error("the redaction resource audit must not prepare response bytes");
    },
  });
}

describe("redaction surface scan — archived capture resource canaries", () => {
  it("serves only the exact-id URL after verifying canary-bearing archived bytes", async () => {
    const { database, record, bytes, ref } = seedCanaryArchive();
    const open = vi.fn(async () => Readable.from([bytes]));

    const resource = await buildArchivedCaptureResource({ authority: database, reader: sqliteRunReader(database, manualClock(new Date(NOW))), artifactReader: canaryArtifactReader(open) }, record.runId, ARCHIVE_ARTIFACT_ID);

    assert.deepEqual(open.mock.calls, [[ref]], "the real verifier must open precisely the sealed capture");
    assertNoArchiveResourceCanaries(resource);
    assert.deepEqual(resource, {
      runId: "99999999-0009-4000-8000-999900000009", artifactId: ARCHIVE_ARTIFACT_ID,
      resource: { state: "available", downloadUrl: ARCHIVE_DOWNLOAD_URL },
    });
  });

  for (const scenario of [
    { name: "typed missing", error: new IndexedArtifactBytesMissingError(ARCHIVE_CANARY_TEXT), state: "missing" },
    { name: "typed corruption", error: new ArtifactBytesCorruptError(ARCHIVE_CANARY_TEXT), state: "error" },
    { name: "raw ENOENT", error: Object.assign(new Error(ARCHIVE_CANARY_TEXT), { code: "ENOENT" }), state: "missing" },
    { name: "raw storage failure", error: new Error(ARCHIVE_CANARY_TEXT), state: "error" },
  ] as const) {
    it(`keeps ${scenario.name} canaries out of the authored availability message`, async () => {
      const { database, record, ref } = seedCanaryArchive();
      // Typed failures survive the verifier unchanged. A raw-error-only test
      // would miss a query that copied error.message after normalization.
      assert.deepEqual(canariesIn(scenario.error.message), ALL_CANARY_NAMES, "the error must contain all nine sentinels");
      const open = vi.fn(async () => { throw scenario.error; });

      const resource = await buildArchivedCaptureResource({ authority: database, reader: sqliteRunReader(database, manualClock(new Date(NOW))), artifactReader: canaryArtifactReader(open) }, record.runId, ARCHIVE_ARTIFACT_ID);

      assert.deepEqual(open.mock.calls, [[ref]]);
      assertNoArchiveResourceCanaries(resource);
      assert.deepEqual(resource, {
        runId: "99999999-0009-4000-8000-999900000009", artifactId: ARCHIVE_ARTIFACT_ID,
        resource: scenario.state === "missing"
          ? { state: "missing", reason: "The archived capture's stored bytes are no longer present." }
          : { state: "error", message: "The archived capture bytes could not be verified." },
      });

      // Test-only leaking output: the strict schema admits free text here, so
      // the SAME canary assertion above, not a schema rejection, must catch it.
      const leaky = ArchivedCaptureResourceWireSchema.parse({
        ...resource,
        resource: scenario.state === "missing"
          ? { state: "missing", reason: scenario.error.message }
          : { state: "error", message: scenario.error.message },
      });
      assert.deepEqual(canariesIn(canonicalJsonStringify(leaky)), ALL_CANARY_NAMES);
      assert.throws(() => assertNoArchiveResourceCanaries(leaky), /archived capture resource leaked canaries/u);
    });
  }

  for (const downloadUrl of [
    "/artifacts/v1/archive/99999999-0009-4000-8000-999900000009/00000000-0000-4000-8000-000000000919",
    `/artifacts/v1/archive/${REDACTION_CANARIES.password}/${ARCHIVE_ARTIFACT_ID}`,
  ]) {
    it(`rejects a ${downloadUrl.includes(REDACTION_CANARIES.password) ? "canary" : "foreign"} archive download URL`, async () => {
      const { database, record, bytes } = seedCanaryArchive();
      const resource = await buildArchivedCaptureResource({
        authority: database,
        reader: sqliteRunReader(database, manualClock(new Date(NOW))),
        artifactReader: canaryArtifactReader(async () => Readable.from([bytes])),
      }, record.runId, ARCHIVE_ARTIFACT_ID);
      assert.equal(resource.resource.state, "available");
      const parsed = ArchivedCaptureResourceWireSchema.safeParse({
        ...resource, resource: { state: "available", downloadUrl },
      });
      assert.equal(parsed.success, false, "the resource URL must bind the exact requested identities");
      assert.ok(!parsed.success);
      assert.deepEqual(parsed.error.issues.map(({ path }) => path), [["resource", "downloadUrl"]]);
    });
  }
});

describe("redaction surface scan — the canary sweep (ref clock-config-secrets §6)", () => {
  it("plants a sentinel in every free-text leaf the failure record has", () => {

    const planted = canariesIn(canonicalJsonStringify(CANARY_FAILURE));
    for (const name of ["personName", "ssn", "dob", "cookie", "storageState", "credentialPath", "privateKey", "emplId"] as const) {
      assert.ok(planted.includes(name), `the ${name} canary never reached the failure record`);
    }
  });

  it("leaves no notification arm where a captured value could be written", () => {

    const accepted: string[] = [];
    for (const event of TRIGGER_EVENTS) {
      const projected = projectNotificationTrigger(event);
      const leaked = canariesIn(`${projected.title}\n${projected.summary}\n${canonicalJsonStringify(projected.links)}`);
      assert.deepEqual(leaked, [], `the ${String(event.kind)} notification carried ${leaked.join(", ")}`);
      for (const key of Object.keys(event)) {
        if (key === "kind") continue;
        const poisoned = { ...event, [key]: REDACTION_CANARIES.personName };
        if (NotificationTriggerEventSchema.safeParse(poisoned).success) {
          accepted.push(`${String(event.kind)}.${key}`);
        }
      }
    }
    assert.deepEqual(
      accepted,
      [],
      `a notification trigger field accepted free text: ${accepted.join(", ")}`,
    );
  });

  it("keeps an undeclared value out of the durable ledger line", () => {
    const outbox = AtomicOutboxRecordSchema.parse({
      outboxId: UUID_6,
      aggregate: { kind: "write-intent", writeIntentId: UUID_1, generation: 1 },
      payload: LEDGER_OUTBOX_PAYLOAD,
      projection: { state: "pending" },
      createdAt: NOW,
    });
    assert.equal(outbox.payload.kind, "ledger-entry");
    const line = canonicalJsonStringify(LedgerEntrySchema.parse({ outboxId: outbox.outboxId, seq: 1, payload: LEDGER_OUTBOX_PAYLOAD.entry }));
    assert.deepEqual(
      canariesIn(line, UNIVERSAL_CANARY_NAMES),
      [],
      "a filed-transaction record is a transaction fact, never a credential",
    );


    const smuggled = {
      ...outbox,
      payload: {
        ...outbox.payload,
        entry: { ...LEDGER_OUTBOX_PAYLOAD.entry, operatorNote: REDACTION_CANARIES.ssn },
      },
    };
    assert.throws(
      () => LedgerEntrySchema.parse({ outboxId: smuggled.outboxId, seq: 2, payload: smuggled.payload.entry }),
      "an undeclared ledger field must be refused, not serialized",
    );
  });

  it("retains the exit run's supplied person identifiers in its evidence receipt", () => {

    const database = openDatabase();
    const seeded = seedPersonLookupExitRun(database);
    const subjectName = "Battistessa, Johnnie";
    assert.ok(
      canonicalJsonStringify(seeded.checkpoints).includes(subjectName),
      "the exit run's checkpoints must actually carry the subject name",
    );

    const receipt = buildRunEvidenceReceipt({
      descriptor: personLookupDescriptor,
      run: seeded.run,
      result: database.authority.runResults.get(EXIT_RUN_ID),
      checkpoints: seeded.checkpoints,
    });
    const serialized = canonicalJsonStringify(receipt);
    assert.ok(serialized.includes(subjectName), "the receipt omitted the retained subject name");
    assert.ok(serialized.includes("Battistessa"), "the receipt omitted the retained surname");
    assert.ok(serialized.includes("nnie"), "the complete subject name must include its final characters");
  });

  it("retains classified and unclassified diagnostic values", () => {
    const result = redactDiagnosticFields([
      { key: "pageState", classification: "safe-diagnostic", transform: "allow", value: "crm.person.results" },
      { key: "sessionCookie", classification: "secret", transform: "digest", value: REDACTION_CANARIES.cookie },
      { key: "credentialFile", classification: "credential-file", transform: "digest", value: REDACTION_CANARIES.credentialPath },
      { key: "candidateName", classification: "direct-identifier", transform: "last4", value: REDACTION_CANARIES.personName },
      { unclassified: REDACTION_CANARIES.ssn },
    ]);
    assert.deepEqual(canariesIn(canonicalJsonStringify(result)).toSorted(), ["cookie", "credentialPath", "personName", "ssn"]);
    assert.equal(result.fields.length, 4, "every classified field retains its original value");
    assert.equal(result.warnings.length, 1, "the unclassified field remains visible in a warning");
  });

  it("detects a planted sentinel when one really is present", () => {

    const allowed = redactValue("safe-diagnostic", "allow", REDACTION_CANARIES.ssn);
    assert.deepEqual(canariesIn(canonicalJsonStringify(allowed)), ["ssn"]);
    assert.deepEqual(
      canariesIn(`prefix ${REDACTION_CANARIES.password} suffix`),
      ["password"],
    );
    assert.deepEqual(canariesIn("nothing to see"), []);
    assert.equal(ALL_CANARY_NAMES.length, Object.keys(REDACTION_CANARIES).length);
  });
});
