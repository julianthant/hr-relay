/**
 * Ref guards-and-tests §3.15 / D183 — the redaction surface scan.
 *
 * The 2j checklist asks for "a sweep proving no classified leaf reaches any
 * wire/log/notification/ledger/advisory surface unredacted". Until D183 that
 * sentence had no owner: redaction appeared as a CLAUSE inside four other
 * guards, each looking at one producer. Four partial views of a rule are not
 * the rule, and none of them could answer "what about the surface nobody
 * thought of?".
 *
 * This guard has two halves, and neither is sufficient alone.
 *
 * **(a) The declaration audit** walks every registered surface's own schema and
 * demands a declared ORIGIN for every free-text and open-JSON leaf, then holds
 * that origin against the surface's egress class. It catches the leak that has
 * not happened yet: a field added to a wire schema is a new undispositioned
 * leaf and the guard goes red before the field can ship. It cannot catch a
 * producer that writes a value the schema permits but the declaration did not
 * anticipate.
 *
 * **(b) The canary sweep** plants impossible-by-construction sentinels — a
 * password, a cookie, a storage-state blob, a private key, a credential file
 * path, an unissued SSN, an impossible DOB (ref clock-config-secrets §6's exact list) — into the
 * real producers and scans the produced bytes. It catches what the declarations
 * missed, and it cannot tell you anything about a field nobody has written to
 * yet.
 *
 * Every mechanical arm below carries a negative control, because an arm that
 * would pass a deliberately-leaking fixture is not enforcement (the same reason
 * `ratchet-arms.ts` executes each ratchet against a violating fixture).
 *
 * ## What this guard deliberately does NOT restate
 *
 * - `no-secret-values-in-logs.test.ts` — a credential interpolated into a `log.*`
 *   call. That is a source-shape ratchet over `src/`; this is a surface audit.
 * - `secrets-single-source.test.ts` — who may read `process.env`.
 * - `evidence-receipt.test.ts` — the receipt's own canaries, its
 *   declaration-time refusal of a forbidden `(classification, transform)` pair,
 *   and its undeclared-leaf failure.
 * - `advisory-redaction.test.ts` (unit) — the advisory's name/EID leak arms.
 * - `notification-durability.test.ts`, `capture-durability-and-scope.test.ts`.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { manualClock } from "../../../src/domain/clock.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { ExplorerPresentationLabelSchema } from "../../../src/domain/dashboard/explorer.js";
import { AtomicOutboxRecordSchema } from "../../../src/domain/outbox.js";
import { SpanAuthorityReconciliationWireSchema } from "../../../src/domain/dashboard/storage.js";
import { redactDiagnosticFields, redactValue } from "../../../src/domain/redaction.js";
import {
  NotificationTriggerEventSchema,
  projectNotificationTrigger,
} from "../../../src/domain/notification-triggers.js";
import { buildFailureTriagePrompt } from "../../../src/domain/trust/advisory.js";
import { FailureRecordSchema } from "../../../src/domain/trust/failure.js";
import { buildRunEvidenceReceipt } from "../../../src/core/evidence-receipt.js";
import { ledgerLineForOutbox } from "../../../src/infra/ledger/ledger-projector.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { personLookupDescriptor } from "../../../src/workflows/person-lookup/descriptor.js";
import {
  LEDGER_OUTBOX_PAYLOAD,
  NOW,
  UUID_1,
  UUID_6,
} from "../fixtures/phase1c-contract-fixtures.js";
import { MAXIMAL_FAILURE } from "../fixtures/advisory-fixtures.js";
import {
  EXIT_RUN_ID,
  seedPersonLookupExitRun,
} from "../fixtures/receipt-run-fixtures.js";
import { REPO_ROOT } from "./helpers/guard-files.js";
import {
  ALL_CANARY_NAMES,
  auditRedactedProducers,
  auditSurfaceOrigins,
  canariesIn,
  decidableLeaves,
  REDACTED_NAME_WAIVERS,
  REDACTION_CANARIES,
  REDACTION_SURFACES,
  redactedProducerSites,
  SURFACE_LEAF_ORIGINS,
  SURFACE_MODULE_DISPOSITIONS,
  scannedSurfaceModules,
  surfaceLeaves,
  UNIVERSAL_CANARY_NAMES,
  type RedactionSurface,
  type SurfaceLeafOrigin,
} from "./helpers/redaction-surface-audit.js";

/* ── the modules whose exported wire schemas must be covered ─────────────── */

const WIRE_SCHEMA_MODULES = [
  "../../../src/domain/capture-surface.js",
  "../../../src/domain/dashboard/actions.js",
  "../../../src/domain/dashboard/activity.js",
  "../../../src/domain/dashboard/advisory.js",
  "../../../src/domain/dashboard/archive.js",
  "../../../src/domain/dashboard/artifacts.js",
  "../../../src/domain/dashboard/bootstrap.js",
  "../../../src/domain/dashboard/diagnostic-bundle.js",
  "../../../src/domain/dashboard/explorer.js",
  "../../../src/domain/dashboard/primitives.js",
  "../../../src/domain/dashboard/projection.js",
  "../../../src/domain/dashboard/run-comparison.js",
  "../../../src/domain/dashboard/run-detail.js",
  "../../../src/domain/dashboard/storage.js",
  "../../../src/domain/dashboard/subscription.js",
  "../../../src/domain/intake/wire.js",
  "../../../src/domain/trust/failure.js",
] as const;

/** `a.b[].c` is covered by `payload.a.b[].c`; a bare name is covered by `x.name`. */
function pathCoveredBy(candidate: string, owned: readonly string[]): boolean {
  return owned.some((path) => path === candidate || path.endsWith(`.${candidate}`));
}

/* ── (a) the declaration audit ───────────────────────────────────────────── */

describe("redaction surface scan — the declaration audit (ref guards-and-tests §3.15, D183)", () => {
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

  it("audits a real surface rather than an empty set", () => {
    // A registry that silently emptied would make the arm above vacuously
    // green. The counts are floors, not pins: adding a surface must not force
    // an edit here, removing every one of them must.
    assert.ok(REDACTION_SURFACES.length >= 20, "the surface registry collapsed");
    assert.ok(SURFACE_LEAF_ORIGINS.length >= 200, "the disposition table collapsed");
    const audited = REDACTION_SURFACES.flatMap((surface) => decidableLeaves(surface.schema));
    assert.ok(audited.length >= 200, "the audit walked almost no leaves");
    const egressClasses = new Set(REDACTION_SURFACES.map(({ egress }) => egress));
    assert.equal(egressClasses.size, 6, "every egress class must have at least one registered surface");
  });

  it("refuses full person identifiers in span/authority diagnostic messages", () => {
    const canonicalEid = "10873698";
    const sensitiveDetail = {
      state: "malformed",
      findings: [{
        kind: "malformed-span",
        fileName: "person-lookup-2026-08-28.jsonl",
        lineNumber: 1,
        detail: `span root contained EID ${canonicalEid}`,
      }],
    };
    assert.equal(SpanAuthorityReconciliationWireSchema.safeParse(sensitiveDetail).success, false);
    assert.equal(SpanAuthorityReconciliationWireSchema.safeParse({
      state: "unavailable",
      reason: `authority lookup failed for EID ${canonicalEid}`,
    }).success, false);
  });

  it("registers every surface-bearing module in both directions", () => {
    const scanned = scannedSurfaceModules();
    const declared = SURFACE_MODULE_DISPOSITIONS.map(({ module }) => module).sort();
    assert.deepEqual(
      declared,
      [...scanned].sort(),
      "every module that can declare a wire or durable surface needs a disposition; a new file "
      + "under src/domain/dashboard (or a new entry in EXTRA_SURFACE_MODULES) is a whole surface "
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
    // Coverage is checked across the WHOLE registry, not module by module: a
    // shared primitive is declared in one module and embedded by another, and
    // `FeatureAvailabilityWireSchema` (primitives) reaching the wire only
    // through `FrontendBootstrapWireSchema` (bootstrap) is the normal case, not
    // an escape.
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
        // A schema whose only leaf is the root is a bare scalar or union — it
        // declares no field of its own, so it cannot introduce an unreviewed
        // one; whatever embeds it audits the field it lands in.
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
    // Negative controls: each arm of `auditSurfaceOrigins` is executed against a
    // fixture that violates exactly it. An audit that stayed green on these
    // would be a table nobody has to keep true.
    const leakyWire = z.strictObject({ ok: z.enum(["yes", "no"]), note: z.string().min(1) });
    const loopback: RedactionSurface = {
      id: "fixture/loopback",
      egress: "operator-loopback",
      module: "src/domain/dashboard/run-detail.ts",
      schema: leakyWire,
    };
    const toast: RedactionSurface = {
      id: "fixture/toast",
      egress: "os-notification",
      module: "src/domain/notification-triggers.ts",
      schema: leakyWire,
    };
    const durable: RedactionSurface = {
      id: "fixture/durable",
      egress: "durable-authority",
      module: "src/domain/trust/failure.ts",
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
    // Two halves of one promise. The declaration half is inside
    // `auditSurfaceOrigins` (a `*Redacted` leaf declared as anything but
    // `declared-redacted` fails unless the NAME is waived with a reason); this
    // is the producer half, which the shape audit cannot see.
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
    // The walk must recognise a `RedactedField` by its arm SIGNATURE, because
    // `z.toJSONSchema` hoists shared subtrees behind `$ref` once a schema is
    // embedded — a byte comparison against a standalone serialization stops
    // matching exactly when the surface grows, and every redacted value would
    // decompose into a free-text `key` and an open `value`.
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

function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-redaction-scan-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    manualClock(new Date(NOW)),
  );
  databases.push(database);
  return database;
}

describe("redaction surface scan — the canary sweep (ref clock-config-secrets §6)", () => {
  it("plants a sentinel in every free-text leaf the failure record has", () => {
    // The plant is asserted before anything is derived from it. A sweep whose
    // sentinels never made it into the source proves nothing about the
    // producers, and would go green forever the day a fixture field is renamed.
    const planted = canariesIn(canonicalJsonStringify(CANARY_FAILURE));
    for (const name of ["personName", "ssn", "dob", "cookie", "storageState", "credentialPath", "privateKey", "emplId"] as const) {
      assert.ok(planted.includes(name), `the ${name} canary never reached the failure record`);
    }
  });

  it("drops every planted sentinel from the advisory prompt that leaves the process", () => {
    const prompt = buildFailureTriagePrompt(CANARY_FAILURE);
    const serialized = canonicalJsonStringify(prompt);
    const leaked = canariesIn(serialized);
    assert.deepEqual(
      leaked,
      [],
      `the advisory prompt is the only payload that leaves this machine and it carried ${leaked.join(", ")}`,
    );

    // D178's other half: a dropped leaf still APPEARS, as its redacted arm.
    // Silence would tell the model the fact does not exist, which is a
    // different — and false — statement from "withheld by policy".
    const withheld = prompt.facts.filter(({ state }) => state === "redacted").map(({ key }) => key);
    for (const key of ["summary", "causeChain.summary", "remediation.message", "page.urlRedacted", "subject.observed.displayRedacted"]) {
      assert.ok(withheld.includes(key), `${key} must appear in the prompt as a withheld fact`);
    }
  });

  it("leaves no notification arm where a captured value could be written", () => {
    // D138's rule stated as a property of the schema rather than of the
    // current call sites: every trigger arm is ids, closed codes and counts, so
    // there is nowhere to put free text even on purpose. That, not review, is
    // what makes "notification text carries no captured form contents" true.
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
    const line = ledgerLineForOutbox(outbox, 1);
    assert.deepEqual(
      canariesIn(line, UNIVERSAL_CANARY_NAMES),
      [],
      "a filed-transaction record is a transaction fact, never a credential",
    );

    // The ledger file is never pruned (ref write-safety §6), so a value that reached it
    // is permanent. `ledgerLineText` re-parses through the strict schema, which
    // is what makes an extra key on the row unable to ride along.
    const smuggled = {
      ...outbox,
      payload: {
        ...outbox.payload,
        entry: { ...LEDGER_OUTBOX_PAYLOAD.entry, operatorNote: REDACTION_CANARIES.ssn },
      },
    };
    assert.throws(
      () => ledgerLineForOutbox(smuggled as never, 2),
      "an undeclared ledger field must be refused, not serialized",
    );
  });

  it("redacts the exit run's person identifiers out of its evidence receipt", () => {
    // The REAL 2026-08-04 exit run through the REAL derivation. Its subject's
    // name is the canary: it is genuinely present in the stored checkpoints and
    // is declared `direct-identifier`/`last4`, so a receipt that still spells it
    // means the declared transform did not run on the path that matters.
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
    assert.ok(!serialized.includes(subjectName), "the receipt spelled the subject's full name");
    assert.ok(!serialized.includes("Battistessa"), "the receipt spelled the subject's surname");
    assert.ok(serialized.includes("nnie"), "the declared last4 transform must still answer the question");
    assert.deepEqual(canariesIn(serialized), [], "the receipt carried a planted sentinel");
  });

  it("drops an unclassified diagnostic field instead of passing it through", () => {
    const result = redactDiagnosticFields([
      { key: "pageState", classification: "safe-diagnostic", transform: "allow", value: "crm.person.results" },
      { key: "sessionCookie", classification: "secret", transform: "digest", value: REDACTION_CANARIES.cookie },
      { key: "credentialFile", classification: "credential-file", transform: "digest", value: REDACTION_CANARIES.credentialPath },
      { key: "candidateName", classification: "direct-identifier", transform: "last4", value: REDACTION_CANARIES.personName },
      { unclassified: REDACTION_CANARIES.ssn },
    ]);
    assert.deepEqual(canariesIn(canonicalJsonStringify(result)), [], "a diagnostic bundle carried a sentinel");
    assert.equal(result.fields.length, 4, "every classified field is kept in its transformed form");
    assert.equal(result.warnings.length, 1, "the unclassified field is dropped WITH a warning, never silently");
  });

  it("detects a planted sentinel when one really is present", () => {
    // The negative control for the whole sweep: `canariesIn` must fire. Every
    // assertion above is of the form "nothing found", which is exactly the
    // shape that passes when the instrument is broken.
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
