import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { RunLifecycleSchema } from "../../../src/models/run/record.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { composeCommandRequest } from "../../../src/dashboard/app/commands/command-dispatch.js";
import { sqliteRunReader } from "../../support/helpers/canonical-run-reader.js";
import { dashboardRouteSource } from "./helpers/dashboard-route-source.js";
// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { ActionCommandKeySchema } from "../../../src/models/dashboard/actions.js";
import {
  ParkedWriteDetailWireSchema,
  ParkedWriteSubjectEvidenceSchema,
  RunDetailSectionResponseSchema,
} from "../../../src/models/dashboard/run-detail.js";
import { QueuePrioritySchema, QueueStatusSchema } from "../../../src/models/dashboard/projection.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { queueRowActions } from "../../../src/backend/runs/projections/queue-row-actions.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { RunPrioritySchema } from "../../../src/models/run/envelope.js";
import { RunOutcomeSchema, RunRecordSchema, RunStateSchema, type RunRecord } from "../../../src/models/run/record.js";
import { SubjectEvidenceSchema, WriteIntentRecordSchema } from "../../../src/rules/write-safety/write-safety.js";
import { availableSections, readRunDetail, readRunSection } from "../../../src/backend/runs/queries/run-detail.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { DiagnosticBundleSchema } from "../../../src/models/trust/diagnostic.js";
import { deriveDiagnosticContentDigest } from "../../../src/models/trust/diagnostic-capture.js";
import {
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "../../support/helpers/backend/dashboard-harness.js";
import { REPO_ROOT } from "../support/helpers/guard-files.js";
import {
  armField,
  clientRouteReferences,
  discriminantValues,
  projectedCommandKeys,
  normalizeClientPath,
  readPendingWireBindings,
  routeConnectivityProblems,
  routeMatches,
  servedRoutes,
  PENDING_WIRE_BINDINGS_PATH,
  type PendingWireBinding,
} from "./helpers/wire-connectivity.js";

const worlds: DashboardWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.dispose();
});

const SECTION_SCHEMA_NAME = "RunDetailSectionResponseSchema";

const SECTION_DESCRIPTOR_PRODUCER = "src/backend/runs/queries/run-detail/gate-park.ts";
const API_ROUTES_FILE = "src/backend/transports/http/routes/api.ts";
const CLIENT_ROOTS = ["src/dashboard/client"];

const MANIFEST = readPendingWireBindings();

async function scannedAndSavedReferences() {
  return clientRouteReferences(CLIENT_ROOTS.map(root => join(REPO_ROOT, root)));
}

function servedDashboardRoutes() {
  return servedRoutes(`${dashboardRouteSource()}\n${readFileSync(join(REPO_ROOT, "src/backend/app/composition/dashboard/compose.ts"), "utf8")}`);
}

function bindingsFor(prefix: string): readonly PendingWireBinding[] {
  return MANIFEST.filter(({ binding }) => binding.startsWith(prefix));
}

/* ── the reachable-section sweep ─────────────────────────────────────────── */

const PARK_INTENT_ID = uuidOf(91);
const PARK_INSTANT = "2026-07-31T17:00:00.000Z";
const CLAIM = {
  workerId: "sweep-worker-1",
  claimedAt: PARK_INSTANT,
  heartbeatAt: PARK_INSTANT,
} as const;

interface LifecycleCase {
  readonly label: string;
  readonly lifecycle: unknown;
  /** A claimed/terminal run has been claimed at least once (the record refines it). */
  readonly claimGeneration?: number;
}


function lifecycleCases(): readonly LifecycleCase[] {
  const cases: LifecycleCase[] = [
    { label: "queued", lifecycle: { state: "queued" } },
    { label: "claimed", lifecycle: { state: "claimed", ...CLAIM }, claimGeneration: 1 },
    { label: "validating", lifecycle: { state: "validating", ...CLAIM }, claimGeneration: 1 },
    { label: "running", lifecycle: { state: "running", ...CLAIM }, claimGeneration: 1 },
    {
      label: "parked-gate",
      lifecycle: { state: "parked-gate", gateId: "identity-approval", parkedAt: PARK_INSTANT, resumeAt: "probe" },
    },
    {
      label: "parked-write",
      lifecycle: {
        state: "parked-write",
        writeIntentId: PARK_INTENT_ID,
        intentGeneration: 1,
        parkedAt: PARK_INSTANT,
        code: "unknown",
        message: "the recovery probe is indeterminate",
      },
    },
  ];
  for (const outcome of RunOutcomeSchema.options) {
    cases.push({
      label: `terminal:${outcome}`,
      claimGeneration: 1,
      lifecycle: {
        state: "terminal",
        outcome,
        endedAt: PARK_INSTANT,
        ...(outcome === "failed" ? { failureId: uuidOf(92) } : {}),
      },
    });
  }
  return cases;
}

/** Every section any lifecycle can advertise, with and without the trust seam. */
async function reachableSections(): Promise<{ readonly reachable: ReadonlySet<string>; readonly statesSwept: ReadonlySet<string> }> {
  const world = await makeWorld();
  worlds.push(world);
  queuedEventOf(world, { seed: 1 });
  const row = world.projection.runFold(uuidOf(1));
  if (row === undefined) throw new Error("the sweep's own fixture produced no span fold");

  const trust = {
    ensureReceipt: () => {
      throw new Error("the sweep never derives a receipt; it only asks what is advertised");
    },
    getFailure: () => undefined,
    countFailuresByFingerprint: () => 1,
  };

  const reachable = new Set<string>();
  const statesSwept = new Set<string>();
  for (const { lifecycle: lifecycleInput, claimGeneration } of lifecycleCases()) {
    const lifecycle = RunLifecycleSchema.parse(lifecycleInput);
    const record: RunRecord = RunRecordSchema.parse({
      ...runRecordOf({ seed: 1, enqueuedAt: PARK_INSTANT, ...(claimGeneration === undefined ? {} : { claimGeneration }) }),
      lifecycle,
      ...(lifecycle.state === "terminal" && (lifecycle.outcome === "done" || lifecycle.outcome === "failed") ? {
        version: 2, claimGeneration: 1, updatedAt: lifecycle.endedAt,
        completion: { schemaVersion: 1, kind: lifecycle.outcome, expectedVersion: 1, claim: { workerId: "worker-1", claimGeneration: 1 }, authorizedAt: lifecycle.endedAt,
          ...(lifecycle.outcome === "done" ? { resultDigest: "a".repeat(64) } : { failureId: lifecycle.failureId }) },
      } : {}),
    });
    statesSwept.add(record.lifecycle.state);
    // BOTH compositions: the trust seam is optional, so a section it gates is
    // reachable only if some real composition supplies it — and one does.
    for (const section of availableSections(row, record)) reachable.add(section);
    for (const section of availableSections(row, record, trust)) reachable.add(section);
  }

  const profile = await createBoundProfileFixture();
  const database = AuthorityDatabase.open({ path: profile.path,
    busyTimeoutMs: 1000, migrationOwner: "wire-capture-census" }, world.clock);
  try {
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const run = world.authority.getRun(uuidOf(1));
    assert.ok(run);
    database.authority.runs.enqueue(run);
    const bytes = Buffer.from("[]");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const deps = { timeline: database.authority.timelineEvents, runReader: sqliteRunReader(database, world.clock), stateRoot: world.stateRoot, projection: world.projection,
      authority: { ...world.authority, getRun: (id: string) => database.authority.runs.get(id) },
      descriptors: { resolve: () => undefined },
      captures: { authority: database.authority.diagnosticBundles, artifactReader: {
        verify: async (ref: { id: string; bytes: number; sha256: string; mediaType: string }) => {
          assert.deepEqual(ref, { id: uuidOf(931), bytes: 2, sha256: digest, mediaType: "application/json" });
        },
        prepare: async () => { throw new Error("census must not prepare response bytes"); },
      } },
    };
    assert.equal((await readRunDetail(deps, uuidOf(1))).availableSections.includes("captures"), false);
    const content = { runId: uuidOf(1), origin: { kind: "operator-request", requestedBy: "local-operator" },
      capturedAt: PARK_INSTANT, configFingerprint: run.envelope.configFingerprint,
      descriptorFingerprint: run.envelope.contractFingerprint, redaction: { fields: [], warnings: [] },
      attachments: [{ kind: "console-summary", artifactId: uuidOf(931), mediaType: "application/json",
        byteLength: bytes.length, digest, sensitivity: "redacted" }],
    };
    const { capturedAt, ...stored } = content;
    database.authority.diagnosticBundles.insert(DiagnosticBundleSchema.parse({ ...stored,
      bundleId: uuidOf(932), createdAt: capturedAt, contentDigest: deriveDiagnosticContentDigest(content),
      retention: { kind: "ordinary", purgeAfter: "2026-09-02T17:00:00.000Z" },
    }));
    assert.equal((await readRunSection(deps, uuidOf(1), "captures")).section, "captures");
    const detail = await readRunDetail(deps, uuidOf(1));
    assert.deepEqual(detail.captures, { state: "available", artifactCount: 1 }, "the async census did not verify its canonical capture");
    for (const section of detail.availableSections) reachable.add(section);
  } finally { database.close(); await profile.close(); }
  return { reachable, statesSwept };
}

/* ── the kernel-internal command exemptions ──────────────────────────────── */

// Row actions omit commands targeting another scope or requiring a dedicated input surface.

function projectedRowCommands(): ReadonlySet<string> {
  const commands = new Set<string>();
  for (const status of QueueStatusSchema.options) {
    for (const isMember of [false, true]) {
      const actions = queueRowActions(STANDARD_WORKFLOW_ACTIONS, {
        status,
        rowRevision: 1,
        dryRun: false,
        isChild: false,
        parkedWrite: false,
        memberCount: 0,
        isMember,
        named: false,
        hasReviewPanel: false,
      });
      for (const action of actions) if (action.kind === "command") commands.add(action.command);
    }
  }
  return commands;
}

// Retained commands remain kernel-readable without a dashboard action opportunity.
const RETAINED_UNPROJECTED_ACTIONS = new Set(["retry", "restart"]);

const KERNEL_ONLY_COMMANDS: Readonly<Record<string, string>> = {
  "annotate-failure": "failure resolution targets an exact failure/version and uses the resolution command payload, not a generic run action descriptor",
  "set-batch-grouping": "queue batch controls target batch presentation, not an executable run row",
  "start-run": "the Start surface composes a start plan; there is no run row to hang it off yet",
  "plan-worker-count": "worker-browser commands target the worker pool, not a run row",
  "spawn-worker": "worker-browser commands target the worker pool, not a run row",
  "stop-worker": "worker-browser commands target the worker pool, not a run row",
  "remove-worker": "worker-browser commands target the worker pool, not a run row",
  "retry-worker": "worker-browser commands target the worker pool, not a run row",
  "pause-worker": "worker-browser commands target the worker pool, not a run row",
  "resume-worker": "worker-browser commands target the worker pool, not a run row",
  "refresh-browser": "worker-browser commands target the worker pool, not a run row",
  "reopen-browser": "worker-browser commands target the worker pool, not a run row",
  "apply-settings": "the Settings surface owns the whole payload; a row control cannot express it",
  "apply-protected-settings": "the Settings surface owns its write-only protected payload; row actions cannot express it",
  "plan-storage-relocation": "Settings plans a complete installation root pair; no run row owns storage location",
  "cancel-storage-relocation": "Settings cancels the current installation plan revision; no run row owns storage location",
  "inspect-intake": "the intake surface drives the whole session; its targets are intake sessions, not runs",
  "confirm-intake-mapping": "intake session target, not a run row",
  "correct-intake-row": "intake session target, not a run row",
  "exclude-intake-row": "intake session target, not a run row",
  "validate-intake": "intake session target, not a run row",
  "enqueue-intake-manifest": "intake session target, not a run row",
  "notification-read": "the inbox targets a notification row; the bell owns these three",
  "notification-unread": "notification target, not a run row",
  "notification-snooze": "notification target, not a run row",
  "notification-unsnooze": "notification target, not a run row",
  "notification-read-all": "complete actor inbox target, not a run row",
  "notification-unread-all": "complete actor inbox target, not a run row",
  "notification-snooze-all": "complete actor inbox target, not a run row",
  "notification-unsnooze-all": "complete actor inbox target, not a run row",

  "set-assistant-model-preference": "the assistant surface owns the model choice; no run row can express it",
};

/* ── the tests ───────────────────────────────────────────────────────────── */

describe("wire connectivity — declared arms, served arms, and the manifest between them", () => {

  it("has every run-detail section arm either reachable or declared", async () => {
    const arms = discriminantValues(RunDetailSectionResponseSchema, "section");
    assert.ok(arms.length > 0, "the section union introspection found no arms at all");

    const { reachable, statesSwept } = await reachableSections();
    // The sweep is only evidence if it covered every state the schema allows.
    assert.deepEqual(
      [...statesSwept].sort(),
      [...RunStateSchema.options].sort(),
      "the lifecycle sweep does not cover every RunStateSchema member; add the new state's case",
    );

    const declared = new Map(
      bindingsFor(`${SECTION_SCHEMA_NAME}#`).map((entry) => [entry.binding.split("#")[1] ?? "", entry]),
    );
    const problems: string[] = [];
    for (const arm of arms) {
      if (reachable.has(arm)) {
        if (declared.has(arm)) {
          problems.push(
            `${SECTION_SCHEMA_NAME}#${arm} is declared unserved in ${PENDING_WIRE_BINDINGS_PATH}, but `
            + "availableSections now returns it — delete the stale entry in the commit that connected it",
          );
        }
        continue;
      }
      if (!declared.has(arm)) {
        problems.push(
          `${SECTION_SCHEMA_NAME}#${arm} is a declared wire arm that no lifecycle can reach: `
          + "availableSections never returns it, so a client asking for it gets a refusal. Either serve "
          + `it or add {"binding": "${SECTION_SCHEMA_NAME}#${arm}", "direction": "declared-unserved", …} `
          + `to ${PENDING_WIRE_BINDINGS_PATH}`,
        );
      }
    }
    for (const arm of declared.keys()) {
      if (!arms.includes(arm)) {
        problems.push(
          `${PENDING_WIRE_BINDINGS_PATH} declares ${SECTION_SCHEMA_NAME}#${arm}, which the schema no `
          + "longer carries; a manifest entry for a deleted arm is a claim nobody can act on",
        );
      }
    }
    assert.deepEqual(problems, [], `wire connectivity — sections:\n  ${problems.join("\n  ")}`);
  });

  it("names only commands the kernel accepts, and reviews every command it does not name", () => {
    const actionKeys: readonly string[] = [...ActionCommandKeySchema.options];
    const kernelTypes = discriminantValues(CommandRequestSchema, "type");
    assert.ok(kernelTypes.length > actionKeys.length, "the kernel command union introspection under-read");

    const problems: string[] = [];
    for (const key of actionKeys) {
      if (key === "archive") {
        assert.deepEqual(composeCommandRequest({ kind: "command", key: "archive", command: "archive", label: "Archive",
          icon: "archive", intent: "primary", placement: ["menu"], expectedVersion: 1 }, { runId: uuidOf(1), expectedVersion: 1 },
        { actorId: "local-operator", source: "queue", commandId: uuidOf(2), requestedAt: PARK_INSTANT }),
        { state: "refused", reason: "Archive page removed" });
        continue;
      }
      if (!kernelTypes.includes(key)) {
        problems.push(
          `ActionCommandKeySchema names "${key}", which CommandRequestSchema does not accept — a served `
          + "control that 422s on click is worse than an absent one",
        );
      }
      if (Object.hasOwn(KERNEL_ONLY_COMMANDS, key)) {
        problems.push(
          `"${key}" is both a served action key and listed as kernel-internal; one of the two is stale`,
        );
      }
    }
    for (const type of kernelTypes) {
      if (actionKeys.includes(type)) continue;
      if (!Object.hasOwn(KERNEL_ONLY_COMMANDS, type)) {
        problems.push(
          `the kernel accepts "${type}" but no action descriptor may name it and KERNEL_ONLY_COMMANDS `
          + "gives no reason; add it to ActionCommandKeySchema or record why it is kernel-internal",
        );
      }
    }
    for (const type of Object.keys(KERNEL_ONLY_COMMANDS)) {
      if (!kernelTypes.includes(type)) {
        problems.push(`KERNEL_ONLY_COMMANDS exempts "${type}", which the kernel no longer accepts`);
      }
    }

    const projected = new Set<string>([
      ...projectedRowCommands(),
      ...projectedCommandKeys(readFileSync(join(REPO_ROOT, SECTION_DESCRIPTOR_PRODUCER), "utf8")),
    ]);
    assert.ok(projected.size > 3, "the descriptor-producer read under-ran; the scan or the row sweep is stale");
    for (const key of RETAINED_UNPROJECTED_ACTIONS) {
      assert.ok(actionKeys.includes(key) && kernelTypes.includes(key), `stale retained unprojected command: ${key}`);
      assert.ok(!projected.has(key), `retained command became directly projected: ${key}`);
    }
    const navigation = queueRowActions(STANDARD_WORKFLOW_ACTIONS, {status:"failed",rowRevision:1,dryRun:false,isChild:false,
      parkedWrite:false,memberCount:0,isMember:false,named:false,hasReviewPanel:false});
    assert.ok(navigation.some(action => action.kind === "navigation" && action.navigate.kind === "rerun"));
    for (const key of actionKeys) {
      if (key === "archive" || projected.has(key) || RETAINED_UNPROJECTED_ACTIONS.has(key)) continue;
      problems.push(
        `ActionCommandKeySchema names "${key}" and nothing projects it — not queueRowActions over any `
        + `status, and no descriptor literal in ${SECTION_DESCRIPTOR_PRODUCER}. A served key nothing `
        + "projects is a control no surface can draw: either project it or retire it from the vocabulary",
      );
    }
    assert.deepEqual(problems, [], `wire connectivity — commands:\n  ${problems.join("\n  ")}`);
  });

  it("resolves every client-called path to a served route, and declares every uncalled route", async () => {
    const routes = servedDashboardRoutes();
    assert.ok(routes.length > 10, `route extraction from ${API_ROUTES_FILE} found only ${String(routes.length)}`);
    const references = await scannedAndSavedReferences();
    assert.ok(references.length > 10, "client path extraction found almost nothing; the scan is broken");

    const problems = routeConnectivityProblems({ routes, references, pending: MANIFEST, apiRoutesFile: API_ROUTES_FILE, clientRoots: CLIENT_ROOTS });
    assert.deepEqual(problems, [], `wire connectivity — routes:\n  ${problems.join("\n  ")}`);
  });


  it("catches a synthesized orphan arm, a synthesized bad command key, and an unserved path", async () => {
    const orphanUnion = RunDetailSectionResponseSchema.options[0]?.extend({});
    assert.ok(orphanUnion !== undefined);

    // (a) an arm the introspection sees but the reachable set does not.
    const arms = [...discriminantValues(RunDetailSectionResponseSchema, "section"), "invented-section"];
    const { reachable } = await reachableSections();
    assert.ok(!reachable.has("invented-section"));
    assert.ok(arms.some((arm) => !reachable.has(arm) && arm === "invented-section"));

    // (b) a command key the kernel does not accept.
    const kernelTypes = discriminantValues(CommandRequestSchema, "type");
    assert.ok(kernelTypes.includes("resolve-write-absent"), "introspection missed a known kernel verb");
    assert.ok(!kernelTypes.includes("force-done"), "the kernel must never accept a force-done verb");


    assert.deepEqual(
      projectedCommandKeys('/* key: "unhide" is never served */\nconst a = { key: "retry" };'),
      ["retry"],
    );
    assert.deepEqual(projectedCommandKeys('// command: "unhide"\nconst a = { command: "resolve-gate" };'), ["resolve-gate"]);

    const projected = new Set<string>([
      ...projectedRowCommands(),
      ...projectedCommandKeys(readFileSync(join(REPO_ROOT, SECTION_DESCRIPTOR_PRODUCER), "utf8")),
    ]);
    assert.ok(projected.has("rename"), "the readers missed a verb the row demonstrably serves");
    assert.ok(!projected.has("unhide"));
    assert.ok(!projected.has("force-done"));


    const routes = servedDashboardRoutes();
    assert.ok(!routes.some(({ path }) => routeMatches(path, "/api/v1/invented")));
    assert.ok(routeMatches("/api/v1/runs/:runId", normalizeClientPath("/api/v1/runs/${runId}")));
    assert.ok(!routeMatches("/api/v1/runs/:runId", "/api/v1/runs/abc/logs"));
    assert.ok(!routeMatches("/api/v1/runs/:runId/:section", "/api/v1/runs/abc"));
    assert.ok(!routeMatches("/api/v1/archive", "/api/v1/explorer"));
  });

  it("keeps every wire mirror of a durable vocabulary member-for-member identical", () => {
    // Browser-safe mirrors cannot import the server contract; compare schemas to detect drift.
    const mirrors = [
      {
        name: "parked-write park codes",
        durable: armField(WriteIntentRecordSchema, "status", "parked", "parkedCode"),
        wire: ParkedWriteDetailWireSchema.shape.parkedCode,
      },
      {
        name: "parked-write subject evidence",
        durable: SubjectEvidenceSchema,
        wire: ParkedWriteSubjectEvidenceSchema,
      },
      {
        // The browser-safe scheduling enum must match the server contract without importing its Node dependencies.
        name: "run priority",
        durable: RunPrioritySchema,
        wire: QueuePrioritySchema,
      },
    ] as const;

    for (const mirror of mirrors) {
      assert.deepEqual(
        z.toJSONSchema(mirror.wire, { io: "output" }),
        z.toJSONSchema(mirror.durable, { io: "output" }),
        `${mirror.name}: the wire copy in src/models/dashboard/run-detail.ts has drifted from its `
        + "durable original in src/rules/write-safety/write-safety.ts — the copy exists only because a "
        + "descriptor-closure edit moves contractFingerprint, not because the two may differ",
      );
    }
  });

  it("keeps the manifest itself parseable, unique, and non-empty of reasons", () => {
    const duplicates = MANIFEST
      .map(({ binding }) => binding)
      .filter((binding, index, all) => all.indexOf(binding) !== index);
    assert.deepEqual(duplicates, [], "a wire binding is declared twice");
    for (const entry of MANIFEST) {
      assert.ok(
        entry.note.length > 40,
        `${entry.binding} carries a note too short to say who closes it: ${entry.note}`,
      );
    }
  });
});
