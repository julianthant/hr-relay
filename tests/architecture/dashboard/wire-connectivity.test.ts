import { RunLifecycleSchema } from "../../../src/models/run/record.js";
import { sqliteRunReader } from "../../support/helpers/canonical-run-reader.js";
import { dashboardRouteSource } from "./helpers/dashboard-route-source.js";
// @vitest-environment jsdom
/**
 * Wire connectivity — ref frontend-backend-integration §8.8, both directions (D107's pattern one layer up).
 *
 * The defect class this exists to make loud is "built one half, never
 * connected", and this tree has shipped it twice with every gate green: a
 * `captures` section arm no `availableSections` could ever return, and a
 * `"degraded"` stream arm nothing could emit. Neither is a bug in any one
 * module — each half is correct on its own, which is exactly why nothing
 * caught them. The connection is the thing nobody owned.
 *
 * Three joints are audited, and each fails in BOTH directions:
 *
 *  1. **Section arms.** Every literal arm of `RunDetailSectionResponseSchema`
 *     is either returnable by `availableSections` — proven by CALLING it over
 *     records covering every lifecycle state, not by reading the source — or
 *     declared in `docs/rebuild/migrations/legacy/pending-wire-bindings.json`. A declaration whose arm
 *     has become reachable, or whose arm no longer exists, fails too: a stale
 *     exception is how an inventory rots into a claim nobody can act on
 *     (D184/D188).
 *  2. **Command keys.** Every `ActionCommandKeySchema` verb is accepted by the
 *     kernel's own request union, and every kernel verb is either serveable as
 *     an action or named in a closed exemption table WITH the reason it is
 *     kernel-internal. A served descriptor naming a command the kernel refuses
 *     is a control that 422s on click. And — the direction D234 added, because
 *     the guard had been blind to it — every serveable verb is one some
 *     PRODUCER actually emits: `unhide` sat in the vocabulary for a whole phase
 *     while `queue-row-actions.ts` structurally excluded it, so the key was
 *     kernel-accepted, schema-blessed, and unreachable by any surface. Both
 *     halves of a joint have to exist; a key nothing projects is the same
 *     unbuilt half as a section arm nothing returns.
 *  3. **Routes ↔ client.** Every path the dashboard client calls
 *     resolves to a route `api.ts` registers; a registered route no client
 *     calls is allowed only through the manifest.
 *
 * The manifest is the exception channel, deliberately: an unbuilt half is a
 * legitimate state, and the thing that must never be legitimate is an unbuilt
 * half nobody wrote down.
 */
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
afterEach(() => {
  for (const world of worlds.splice(0)) world.dispose();
});

const SECTION_SCHEMA_NAME = "RunDetailSectionResponseSchema";
/**
 * The gate/park section `ActionDescriptorWire` producer, read as SOURCE.
 *
 * The queue row's producer beside it is CALLED instead (`queueRowActions` is a
 * pure function of a policy and a flat fact record), which is the standard arm
 * 1 already holds itself to. This one composes its descriptors deep inside a
 * whole run-detail build, so a scan of the literals it can emit is the honest
 * cheap reading — and its three verbs are plain literals there.
 */
const SECTION_DESCRIPTOR_PRODUCER = "src/backend/runs/queries/run-detail/gate-park.ts";
const API_ROUTES_FILE = "src/backend/transports/http/routes/api.ts";
const CLIENT_ROOTS = ["src/dashboard/client"];

const MANIFEST = readPendingWireBindings();

async function scannedAndSavedReferences() {
  return clientRouteReferences(CLIENT_ROOTS.map(root => join(REPO_ROOT, root)));
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

/**
 * One legal lifecycle per `RunStateSchema` member, terminal expanded over every
 * `RunOutcomeSchema` member. They are built as plain objects and PARSED, so a
 * state this sweep gets wrong is a schema error rather than a silently
 * unreachable case — and the coverage assertion below makes a newly added
 * lifecycle state fail here until somebody decides what it serves.
 */
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
  const world = makeWorld();
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
  // Captures are an async verified capability, not a lifecycle-derived constant.
  // Keep the complete lifecycle sweep above; add what the public read actually
  // advertises after canonical SQLite diagnostic authority verifies real bytes.
  const database = AuthorityDatabase.open({ path: join(world.stateRoot, "wire-capture-authority.db"),
    busyTimeoutMs: 1000, migrationOwner: "wire-capture-census" }, world.clock);
  try {
    const run = world.authority.getRun(uuidOf(1));
    assert.ok(run);
    database.authority.runs.enqueue(run);
    const bytes = Buffer.from("[]");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const deps = { runReader: sqliteRunReader(database, world.clock), stateRoot: world.stateRoot, projection: world.projection,
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
  } finally { database.close(); }
  return { reachable, statesSwept };
}

/* ── the kernel-internal command exemptions ──────────────────────────────── */

/**
 * Kernel commands that legitimately have no `ActionDescriptorWire`, each with
 * the reason. This is a CLOSED table checked both ways: a verb the kernel
 * dropped fails as a stale entry, and a verb that is neither serveable nor
 * listed fails as an unreviewed asymmetry.
 *
 * The shape of the asymmetry is the point. An action descriptor is ref frontend-backend-integration
 * §3.2's control on a run ROW — so a command whose target is not a run, or
 * whose payload the operator composes on a dedicated surface rather than by
 * clicking a row control, is correctly absent from the vocabulary.
 */
/**
 * Every command verb the QUEUE ROW producer can emit, proven by CALLING it —
 * the standard arm 1 holds itself to, and the reason a `key` that is computed
 * (`cancel-tree` for a group, `cancel` otherwise) is read correctly here and
 * would be missed by any scan of its source.
 *
 * The sweep runs every status against both member and non-member shapes,
 * because the row's admission table narrows on both.
 */
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
        workflowLabel: "Person Lookup",
        hasReviewPanel: false,
      });
      for (const action of actions) if (action.kind === "command") commands.add(action.command);
    }
  }
  return commands;
}

// Retained commands remain kernel-readable without a dashboard action opportunity.
const RETAINED_UNPROJECTED_ACTIONS = new Set(["retry", "restart", "archive"]);

const KERNEL_ONLY_COMMANDS: Readonly<Record<string, string>> = {
  "annotate-failure": "failure resolution targets an exact failure/version and uses the resolution command payload, not a generic run action descriptor",
  "set-batch-grouping": "queue batch controls target batch presentation, not an executable run row",
  "start-run": "the Start surface composes a start plan; there is no run row to hang it off yet",
  "plan-worker-count": "worker-browser commands target the worker pool, not a run row",
  "spawn-worker": "worker-browser commands target the worker pool, not a run row",
  "stop-worker": "worker-browser commands target the worker pool, not a run row",
  "pause-worker": "worker-browser commands target the worker pool, not a run row",
  "resume-worker": "worker-browser commands target the worker pool, not a run row",
  "refresh-browser": "worker-browser commands target the worker pool, not a run row",
  "reopen-browser": "worker-browser commands target the worker pool, not a run row",
  "apply-settings": "the Settings surface owns the whole payload; a row control cannot express it",
  "apply-protected-settings": "the Settings surface owns its write-only protected payload; row actions cannot express it",
  "apply-provider-keys": "the Settings surface owns provider slots; run row actions cannot express them",
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
  "plan-version-bump": "D179's archive planning surface targets the application/workflow scope",
  "apply-version-bump": "archive scope target, not a run row",
  "plan-runtime-version": "Archive runtime version planning targets selected workflows or the dashboard",
  "apply-runtime-version": "Archive runtime version publication targets a reviewed change",
  "relaunch-archived-run": "V retains historical request parsing; current HTTP and internal producers refuse creation",
  "delete-archived-run": "D308 serves the delete from the ARCHIVED detail, which is not a live run row",
  "apply-explorer-edit": "D283's reviewed Explorer draft targets a workflow override revision, not a run row",
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
    /*
     * The direction D234 added. A key the kernel accepts and the vocabulary
     * names is still dead if nothing composes a descriptor for it — which is
     * exactly what `unhide` was, and what the two checks above could not see.
     */
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
      parkedWrite:false,memberCount:0,isMember:false,named:false,workflowLabel:"Fixture",hasReviewPanel:false});
    assert.ok(navigation.some(action => action.kind === "navigation" && action.navigate.kind === "rerun"));
    for (const key of actionKeys) {
      if (projected.has(key) || RETAINED_UNPROJECTED_ACTIONS.has(key)) continue;
      problems.push(
        `ActionCommandKeySchema names "${key}" and nothing projects it — not queueRowActions over any `
        + `status, and no descriptor literal in ${SECTION_DESCRIPTOR_PRODUCER}. A served key nothing `
        + "projects is a control no surface can draw: either project it or retire it from the vocabulary",
      );
    }
    assert.deepEqual(problems, [], `wire connectivity — commands:\n  ${problems.join("\n  ")}`);
  });

  it("resolves every client-called path to a served route, and declares every uncalled route", async () => {
    const routes = servedRoutes(dashboardRouteSource());
    assert.ok(routes.length > 10, `route extraction from ${API_ROUTES_FILE} found only ${String(routes.length)}`);
    const references = await scannedAndSavedReferences();
    assert.ok(references.length > 10, "client path extraction found almost nothing; the scan is broken");

    const problems = routeConnectivityProblems({ routes, references, pending: MANIFEST, apiRoutesFile: API_ROUTES_FILE, clientRoots: CLIENT_ROOTS });
    assert.deepEqual(problems, [], `wire connectivity — routes:\n  ${problems.join("\n  ")}`);
  });

  /*
   * The negative controls. Each arm above is run against a synthesized
   * violation through the SAME entry point, for the reason `ratchet-arms`
   * fixtures exist: a check that has never been observed to fail is
   * indistinguishable from a check that cannot.
   */
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

    // (b2) the producer scan reads CODE, not prose — the arm that would have
    //      caught `unhide`. A key named only in a comment must not count, and a
    //      key named in a descriptor literal must.
    assert.deepEqual(
      projectedCommandKeys('/* key: "unhide" is never served */\nconst a = { key: "retry" };'),
      ["retry"],
    );
    assert.deepEqual(projectedCommandKeys('// command: "unhide"\nconst a = { command: "resolve-gate" };'), ["resolve-gate"]);
    //      And through the REAL readers: a verb no producer emits must be
    //      absent from the projected set, which is what makes the arm above
    //      able to fail at all. `unhide` is the retired key that motivated it
    //      (D234) and `force-done` is one that never existed.
    const projected = new Set<string>([
      ...projectedRowCommands(),
      ...projectedCommandKeys(readFileSync(join(REPO_ROOT, SECTION_DESCRIPTOR_PRODUCER), "utf8")),
    ]);
    assert.ok(projected.has("rename"), "the readers missed a verb the row demonstrably serves");
    assert.ok(!projected.has("unhide"));
    assert.ok(!projected.has("force-done"));

    // (c) a client path with no route, and a route pattern that must not
    //     over-match — a matcher that accepted anything would report every
    //     joint healthy forever.
    const routes = servedRoutes(dashboardRouteSource());
    assert.ok(!routes.some(({ path }) => routeMatches(path, "/api/v1/invented")));
    assert.ok(routeMatches("/api/v1/runs/:runId", normalizeClientPath("/api/v1/runs/${runId}")));
    assert.ok(!routeMatches("/api/v1/runs/:runId", "/api/v1/runs/abc/logs"));
    assert.ok(!routeMatches("/api/v1/runs/:runId/:section", "/api/v1/runs/abc"));
    assert.ok(!routeMatches("/api/v1/archive", "/api/v1/explorer"));
  });

  it("keeps every wire mirror of a durable vocabulary member-for-member identical", () => {
    /*
     * A mirror is the fourth joint, and the one with no import to keep it
     * honest. `run-detail.ts` re-declares ref write-safety's park codes and subject
     * evidence because `write-safety.ts` imports `node:crypto` and this module
     * is in the dashboard bundle's reach — the copy is forced by ref frontend-backend-integration §8.13,
     * so the equality has to be asserted somewhere or it is only a comment.
     *
     * `z.toJSONSchema` is the comparison rather than a hand-listed member set:
     * a member ADDED to either side, a regex loosened on one, or a branded id
     * swapped for a bare string all show up, and none of them would if this
     * test enumerated what it already believed.
     */
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
        /*
         * D95's scheduling class. `src/models/dashboard/projection.ts` is in
         * the dashboard bundle's reach and `src/models/run/envelope.ts` reaches
         * `workflow/checkpoint.js`, so the queue wire re-declares the enum for
         * ref frontend-backend-integration §8.13's reason — and a member added to either side (a third
         * priority class, say) has to show up on both.
         */
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
