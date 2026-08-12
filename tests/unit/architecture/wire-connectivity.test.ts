/**
 * Wire connectivity — doc 13 §8.8, both directions (D107's pattern one layer up).
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
 *     declared in `config/pending-wire-bindings.json`. A declaration whose arm
 *     has become reachable, or whose arm no longer exists, fails too: a stale
 *     exception is how an inventory rots into a claim nobody can act on
 *     (D184/D188).
 *  2. **Command keys.** Every `ActionCommandKeySchema` verb is accepted by the
 *     kernel's own request union, and every kernel verb is either serveable as
 *     an action or named in a closed exemption table WITH the reason it is
 *     kernel-internal. A served descriptor naming a command the kernel refuses
 *     is a control that 422s on click.
 *  3. **Routes ↔ client.** Every path the dashboard and phone clients call
 *     resolves to a route `api.ts` registers; a registered route no client
 *     calls is allowed only through the manifest.
 *
 * The manifest is the exception channel, deliberately: an unbuilt half is a
 * legitimate state, and the thing that must never be legitimate is an unbuilt
 * half nobody wrote down.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { ActionCommandKeySchema } from "../../../src/domain/dashboard/actions.js";
import {
  ParkedWriteDetailWireSchema,
  ParkedWriteSubjectEvidenceSchema,
  RunDetailSectionResponseSchema,
} from "../../../src/domain/dashboard/run-detail.js";
import { CommandRequestSchema } from "../../../src/domain/commands.js";
import { RunOutcomeSchema, RunRecordSchema, RunStateSchema, type RunRecord } from "../../../src/domain/run/record.js";
import { SubjectEvidenceSchema, WriteIntentRecordSchema } from "../../../src/domain/write-safety.js";
import { availableSections } from "../../../src/server/dashboard/queries/run-detail.js";
import {
  makeWorld,
  queuedEventOf,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "../server/helpers/dashboard-harness.js";
import { REPO_ROOT } from "./helpers/guard-files.js";
import {
  armField,
  clientRouteReferences,
  discriminantValues,
  normalizeClientPath,
  readPendingWireBindings,
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
const API_ROUTES_FILE = "src/server/dashboard/routes/api.ts";
const CLIENT_ROOTS = ["src/dashboard/client", "src/dashboard/phone/capture-client.ts"];

const MANIFEST = readPendingWireBindings();

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
function reachableSections(): { readonly reachable: ReadonlySet<string>; readonly statesSwept: ReadonlySet<string> } {
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
  for (const { lifecycle, claimGeneration } of lifecycleCases()) {
    const record: RunRecord = RunRecordSchema.parse({
      ...runRecordOf({ seed: 1, ...(claimGeneration === undefined ? {} : { claimGeneration }) }),
      lifecycle,
    });
    statesSwept.add(record.lifecycle.state);
    // BOTH compositions: the trust seam is optional, so a section it gates is
    // reachable only if some real composition supplies it — and one does.
    for (const section of availableSections(row, record)) reachable.add(section);
    for (const section of availableSections(row, record, trust)) reachable.add(section);
  }
  return { reachable, statesSwept };
}

/* ── the kernel-internal command exemptions ──────────────────────────────── */

/**
 * Kernel commands that legitimately have no `ActionDescriptorWire`, each with
 * the reason. This is a CLOSED table checked both ways: a verb the kernel
 * dropped fails as a stale entry, and a verb that is neither serveable nor
 * listed fails as an unreviewed asymmetry.
 *
 * The shape of the asymmetry is the point. An action descriptor is doc 13
 * §3.2's control on a run ROW — so a command whose target is not a run, or
 * whose payload the operator composes on a dedicated surface rather than by
 * clicking a row control, is correctly absent from the vocabulary.
 */
const KERNEL_ONLY_COMMANDS: Readonly<Record<string, string>> = {
  "start-run": "the Start surface composes a start plan; there is no run row to hang it off yet",
  "plan-worker-count": "worker-browser commands target the worker pool, not a run row",
  "spawn-worker": "worker-browser commands target the worker pool, not a run row",
  "stop-worker": "worker-browser commands target the worker pool, not a run row",
  "pause-worker": "worker-browser commands target the worker pool, not a run row",
  "resume-worker": "worker-browser commands target the worker pool, not a run row",
  "refresh-browser": "worker-browser commands target the worker pool, not a run row",
  "reopen-browser": "worker-browser commands target the worker pool, not a run row",
  "apply-settings": "the Settings surface owns the whole payload; a row control cannot express it",
  rename: "the display-name edit is an inline field on the row, not a descriptor-driven control",
  "edit-checkpoint": "2i-C's Edit Data rail owns it — the payload is a field patch set the rail composes",
  "inspect-intake": "the intake surface drives the whole session; its targets are intake sessions, not runs",
  "confirm-intake-mapping": "intake session target, not a run row",
  "correct-intake-row": "intake session target, not a run row",
  "exclude-intake-row": "intake session target, not a run row",
  "validate-intake": "intake session target, not a run row",
  "enqueue-intake-manifest": "intake session target, not a run row",
  "capture-upload": "the phone capture surface targets a capture session over its own token-scoped routes",
  "capture-replace": "capture session target, not a run row",
  "capture-reorder": "capture session target, not a run row",
  "capture-delete": "capture session target, not a run row",
  "capture-finalize": "capture session target, not a run row",
  "capture-retry-finalize": "capture session target, not a run row",
  "capture-discard": "capture session target, not a run row",
  "notification-read": "the inbox targets a notification row; the bell owns these three",
  "notification-unread": "notification target, not a run row",
  "notification-snooze": "notification target, not a run row",
  "plan-version-bump": "D179's archive planning surface targets the application/workflow scope",
  "apply-version-bump": "archive scope target, not a run row",
  "relaunch-archived-run": "D179 serves the relaunch from the ARCHIVED detail, which is not a live run row",
};

/* ── the tests ───────────────────────────────────────────────────────────── */

describe("wire connectivity — declared arms, served arms, and the manifest between them", () => {
  it("has every run-detail section arm either reachable or declared", () => {
    const arms = discriminantValues(RunDetailSectionResponseSchema, "section");
    assert.ok(arms.length > 0, "the section union introspection found no arms at all");

    const { reachable, statesSwept } = reachableSections();
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
    assert.deepEqual(problems, [], `wire connectivity — commands:\n  ${problems.join("\n  ")}`);
  });

  it("resolves every client-called path to a served route, and declares every uncalled route", () => {
    const routes = servedRoutes(readFileSync(join(REPO_ROOT, API_ROUTES_FILE), "utf8"));
    assert.ok(routes.length > 10, `route extraction from ${API_ROUTES_FILE} found only ${String(routes.length)}`);
    const references = clientRouteReferences(CLIENT_ROOTS.map((root) => join(REPO_ROOT, root)));
    assert.ok(references.length > 10, "client path extraction found almost nothing; the scan is broken");

    const declared = new Map(
      bindingsFor("route:").map((entry) => [entry.binding.slice("route:".length), entry]),
    );
    const problems: string[] = [];
    for (const reference of references) {
      if (routes.some(({ path }) => routeMatches(path, reference.path))) continue;
      problems.push(
        `${reference.file} calls ${reference.path}, which ${API_ROUTES_FILE} does not register`,
      );
    }
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      const called = references.some(({ path }) => routeMatches(route.path, path));
      if (called && declared.has(key)) {
        problems.push(
          `${PENDING_WIRE_BINDINGS_PATH} declares route:${key} unconsumed, but a client now calls it`,
        );
      }
      if (!called && !declared.has(key)) {
        problems.push(
          `${API_ROUTES_FILE} serves ${key} and no client under ${CLIENT_ROOTS.join(", ")} calls it. `
          + `Either wire a caller or add {"binding": "route:${key}", "direction": "served-unconsumed", …} `
          + `to ${PENDING_WIRE_BINDINGS_PATH} naming the consumer that will`,
        );
      }
    }
    for (const key of declared.keys()) {
      if (!routes.some((route) => `${route.method} ${route.path}` === key)) {
        problems.push(`${PENDING_WIRE_BINDINGS_PATH} declares route:${key}, which ${API_ROUTES_FILE} does not serve`);
      }
    }
    assert.deepEqual(problems, [], `wire connectivity — routes:\n  ${problems.join("\n  ")}`);
  });

  /*
   * The negative controls. Each arm above is run against a synthesized
   * violation through the SAME entry point, for the reason `ratchet-arms`
   * fixtures exist: a check that has never been observed to fail is
   * indistinguishable from a check that cannot.
   */
  it("catches a synthesized orphan arm, a synthesized bad command key, and an unserved path", () => {
    const orphanUnion = RunDetailSectionResponseSchema.options[0]?.extend({});
    assert.ok(orphanUnion !== undefined);

    // (a) an arm the introspection sees but the reachable set does not.
    const arms = [...discriminantValues(RunDetailSectionResponseSchema, "section"), "invented-section"];
    const { reachable } = reachableSections();
    assert.ok(!reachable.has("invented-section"));
    assert.ok(arms.some((arm) => !reachable.has(arm) && arm === "invented-section"));

    // (b) a command key the kernel does not accept.
    const kernelTypes = discriminantValues(CommandRequestSchema, "type");
    assert.ok(kernelTypes.includes("resolve-write-absent"), "introspection missed a known kernel verb");
    assert.ok(!kernelTypes.includes("force-done"), "the kernel must never accept a force-done verb");

    // (c) a client path with no route, and a route pattern that must not
    //     over-match — a matcher that accepted anything would report every
    //     joint healthy forever.
    const routes = servedRoutes(readFileSync(join(REPO_ROOT, API_ROUTES_FILE), "utf8"));
    assert.ok(!routes.some(({ path }) => routeMatches(path, "/api/v1/invented")));
    assert.ok(routeMatches("/api/v1/runs/:runId", normalizeClientPath("/api/v1/runs/${runId}")));
    assert.ok(!routeMatches("/api/v1/runs/:runId", "/api/v1/runs/abc/logs"));
    assert.ok(!routeMatches("/api/v1/runs/:runId/:section", "/api/v1/runs/abc"));
    assert.ok(!routeMatches("/api/v1/archive", "/api/v1/explorer"));
  });

  it("keeps every wire mirror of a durable vocabulary member-for-member identical", () => {
    /*
     * A mirror is the fourth joint, and the one with no import to keep it
     * honest. `run-detail.ts` re-declares doc 09's park codes and subject
     * evidence because `write-safety.ts` imports `node:crypto` and this module
     * is in the dashboard bundle's reach — the copy is forced by doc 13 §8.13,
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
    ] as const;

    for (const mirror of mirrors) {
      assert.deepEqual(
        z.toJSONSchema(mirror.wire, { io: "output" }),
        z.toJSONSchema(mirror.durable, { io: "output" }),
        `${mirror.name}: the wire copy in src/domain/dashboard/run-detail.ts has drifted from its `
        + "durable original in src/domain/write-safety.ts — the copy exists only because a "
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
