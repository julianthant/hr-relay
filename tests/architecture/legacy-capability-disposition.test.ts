import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import inventory from "../../config/legacy-capabilities.json" with { type: "json" };
import packageJson from "../../package.json" with { type: "json" };
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { startRebuildRuntime } from "../../src/core/runtime-composition.js";
import { gitVisibleFiles } from "./helpers/guard-files.js";
import {
  FROZEN_LEGACY_ARCHITECTURE_PROVENANCE,
  frozenLegacyPaths,
} from "./helpers/frozen-legacy-architecture-provenance.js";

/**
 * D58 inventories LEGACY capability surfaces — the things the rebuild must
 * replace. Post-D93 those surfaces are preserved as a fixed in-repo provenance
 * snapshot, while every
 * DISPOSITION target names a path in THIS repo. Single-rooted per field by
 * construction, so paths stay unprefixed (see `helpers/guard-files.ts` for the
 * `legacy:` scheme used by the inventories that mix both repos).
 *
 * D184 adds the cutover-readiness half ref guards-and-tests §3.11 has described since round
 * 8 and nothing implemented: a disposition must resolve, agree with its own
 * status, cite evidence that exists, and — the arm this guard exists for — an
 * entry may not stay `open` while the milestone that owns it has already been
 * reported complete by the runtime.
 */
function discoveredCapabilityPaths(): string[] {
  return [...frozenLegacyPaths(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE.capabilities.discoveredPaths)];
}

/**
 * The phase docs' ordered work items, in delivery order (roadmap §Phases at a glance, doc 01's
 * spine table, and §Phase-2's deferred-base-tails table). The ORDER is what
 * makes "this milestone already shipped" derivable instead of hand-typed: the
 * completed set is everything at or before whatever the runtime itself reports
 * as `completedThrough`, so closing a tail is what arms the next sweep. Adding
 * a work item to a phase doc means adding it here, in position.
 */
const MilestoneSchema = z.enum([
  "1a",
  "1b",
  "1c",
  "1d",
  "1e",
  "1f",
  "1g-spine",
  "1i-spine",
  "2-transaction-proof",
  "2g",
  "2h",
  "2i",
  "2j",
  "workflow-admission-backlog",
]);
type Milestone = z.infer<typeof MilestoneSchema>;
const MILESTONE_ORDER: readonly Milestone[] = MilestoneSchema.options;

/**
 * `status` is the cutover flag the envelope's `cutoverRequiresZeroOpen` reads,
 * and it is a PROJECTION of the disposition rather than a second opinion. One
 * table owns the correspondence in both directions, so an entry cannot claim
 * to be closed while its disposition still says nobody decided.
 */
const STATUS_FOR_DISPOSITION = {
  open: "open",
  native: "implemented",
  replaced: "implemented",
  retired: "retired",
  candidateForRetirement: "retirement-candidate",
} as const;

const StatusSchema = z.enum(["open", "implemented", "retired", "retirement-candidate"]);

const DispositionSchema = z.discriminatedUnion("kind", [
  // An open entry must say WHY its milestone is the milestone. A bare
  // `{kind, milestone}` is how 73 entries came to name shipped milestones:
  // there was nothing to contradict.
  z.strictObject({ kind: z.literal("open"), milestone: MilestoneSchema, reason: z.string().min(1) }),
  z.strictObject({ kind: z.literal("native"), milestone: MilestoneSchema, targetIds: z.array(z.string().min(1)).min(1) }),
  z.strictObject({
    kind: z.literal("replaced"),
    milestone: MilestoneSchema,
    replacement: z.string().min(1),
    differencesAccepted: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("retired"),
    milestone: MilestoneSchema,
    evidence: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("candidateForRetirement"),
    milestone: MilestoneSchema,
    evidence: z.array(z.string().min(1)).min(1),
    requiresOperatorAuthorization: z.literal(true),
  }),
]);

const CapabilityEntrySchema = z.strictObject({
  id: z.string().min(1),
  sourcePaths: z.array(z.string().min(1)).min(1),
  kind: z.enum(["service", "route", "dashboard", "cli", "export", "codegen", "maintenance", "dev-tool"]),
  knownConsumers: z.array(z.string().min(1)).min(1),
  disposition: DispositionSchema,
  ownerMilestone: MilestoneSchema,
  verificationEvidence: z.array(z.string().min(1)).min(1),
  status: StatusSchema,
});

const CapabilityInventorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  baselineCommit: z.string().regex(/^[0-9a-f]{40}$/u),
  cutoverRequiresZeroOpen: z.literal(true),
  proxyDispositionAllowed: z.literal(false),
  entries: z.array(CapabilityEntrySchema).min(1),
});

type CapabilityInventory = z.infer<typeof CapabilityInventorySchema>;
type CapabilityEntry = z.infer<typeof CapabilityEntrySchema>;

/**
 * `completedThrough` must be a phase-doc work item, because the whole sweep is
 * its position in that order. `active` deliberately is NOT: once the program
 * leaves Phase 2 the active item is a MIGRATION identifier from §3.3's order,
 * not a base work item, and a guard that parsed it strictly would refuse to
 * run the moment the marker advanced past 2j — turning an unrelated schema
 * into a gate on the program's own progress.
 */
const PhaseStatusSchema = z.object({ completedThrough: MilestoneSchema, active: z.string().min(1) });

/**
 * The completed set comes from the RUNTIME's own marker, read through the same
 * `phase` command an operator runs — never from a list typed into this file. A
 * hand-typed list is a second answer that can disagree with the product.
 */
async function runtimeCompletedThrough(): Promise<Milestone> {
  const written: string[] = [];
  await startRebuildRuntime({
    isolation: rebuildRuntimeIsolation,
    args: ["phase"],
    write: (value: string): void => {
      written.push(value);
    },
  });
  const parsed: unknown = JSON.parse(written[0] ?? "");
  return PhaseStatusSchema.parse(parsed).completedThrough;
}

/** Every git-visible path in THIS repo, plus every directory prefix of one. */
function repoPathIndex(): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const file of gitVisibleFiles(["."])) {
    paths.add(file);
    const segments = file.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      paths.add(segments.slice(0, index).join("/"));
    }
  }
  return paths;
}

export interface CapabilityClosureFacts {
  readonly completedThrough: Milestone;
  readonly repoPaths: ReadonlySet<string>;
  readonly npmScripts: ReadonlySet<string>;
  readonly legacyPathExists: (path: string) => boolean;
}

/**
 * The evidence grammar. Every token is one of four checkable forms; anything
 * else is a sentence nobody can verify, which is what `verificationEvidence`
 * degraded into (73 of 78 entries cited only "the legacy file still exists").
 */
function auditEvidenceToken(entry: CapabilityEntry, token: string, facts: CapabilityClosureFacts): string | undefined {
  const npmRun = /^npm run ([a-z][a-z0-9:-]*)(?: -- .+)?$/u.exec(token);
  if (npmRun !== null) {
    const script = npmRun[1] ?? "";
    return facts.npmScripts.has(script)
      ? undefined
      : `${entry.id}: evidence "${token}" names no script in package.json`;
  }
  if (token.startsWith("legacy-source-present:")) {
    const path = token.slice("legacy-source-present:".length);
    return facts.legacyPathExists(path) ? undefined : `${entry.id}: evidence "${token}" names a legacy path that does not exist`;
  }
  if (token.startsWith("ported-with-provenance:")) {
    const parts = token.split(":");
    const path = parts[2] ?? "";
    if (parts.length !== 4 || !/^[0-9a-f]{40}$/u.test(parts[1] ?? "") || !/^[0-9a-f]{40}$/u.test(parts[3] ?? "")) {
      return `${entry.id}: evidence "${token}" is not ported-with-provenance:<commit>:<legacy path>:<blob>`;
    }
    return facts.legacyPathExists(path) ? undefined : `${entry.id}: evidence "${token}" names a legacy path that does not exist`;
  }
  return facts.repoPaths.has(token)
    ? undefined
    : `${entry.id}: evidence "${token}" resolves to nothing — expected a repo path, an npm script, or a legacy-source-present:/ported-with-provenance: token`;
}

/** Evidence that the REBUILD holds something, as opposed to legacy still holding it. */
function citesRebuildProof(entry: CapabilityEntry, facts: CapabilityClosureFacts): boolean {
  return entry.verificationEvidence.some((token) =>
    /^npm run /u.test(token) || (!token.includes(":") && facts.repoPaths.has(token))
  );
}

export function auditCapabilityClosure(
  capabilityInventory: CapabilityInventory,
  facts: CapabilityClosureFacts,
): readonly string[] {
  const violations: string[] = [];
  const completedIndex = MILESTONE_ORDER.indexOf(facts.completedThrough);

  for (const entry of capabilityInventory.entries) {
    const { disposition } = entry;

    // 1. Status is the disposition's projection, never a second opinion.
    const expectedStatus = STATUS_FOR_DISPOSITION[disposition.kind];
    if (entry.status !== expectedStatus) {
      violations.push(`${entry.id}: disposition ${disposition.kind} requires status ${expectedStatus}, found ${entry.status}`);
    }

    // 2. The entry's owner and the disposition that decided it must agree.
    if (entry.ownerMilestone !== disposition.milestone) {
      violations.push(
        `${entry.id}: ownerMilestone ${entry.ownerMilestone} disagrees with its ${disposition.kind} disposition's milestone ${disposition.milestone}`,
      );
    }

    // 3. A native/replaced target must resolve to a real path in THIS repo. A
    //    target that does not resolve is a replacement claim with nothing
    //    behind it — strictly worse than an honest open entry.
    const targets = disposition.kind === "native"
      ? disposition.targetIds
      : disposition.kind === "replaced"
        ? [disposition.replacement]
        : [];
    for (const target of targets) {
      if (!facts.repoPaths.has(target)) {
        violations.push(`${entry.id}: ${disposition.kind} target ${target} is not a git-visible path in this repo`);
      }
    }

    // 4. A shipped milestone may not still be holding an undecided item.
    if (disposition.kind === "open") {
      const ownerIndex = MILESTONE_ORDER.indexOf(entry.ownerMilestone);
      if (ownerIndex <= completedIndex) {
        violations.push(
          `${entry.id}: still open while its owner ${entry.ownerMilestone} is at or before the runtime's completedThrough ${facts.completedThrough} — decide it, or move ownerMilestone forward with the reason recorded`,
        );
      }
    }

    // 5. Every evidence token must name something that exists, and a decided
    //    entry must cite proof in the REBUILD rather than only asserting that
    //    the legacy source it replaces is still on disk.
    for (const token of entry.verificationEvidence) {
      const violation = auditEvidenceToken(entry, token, facts);
      if (violation !== undefined) violations.push(violation);
    }
    if (disposition.kind !== "open" && !citesRebuildProof(entry, facts)) {
      violations.push(
        `${entry.id}: a ${disposition.kind} entry must cite at least one rebuild path or npm script as evidence; legacy-source-present alone proves nothing about this repo`,
      );
    }
  }

  return violations;
}

const parsedInventory = CapabilityInventorySchema.parse(inventory);

function fixtureInventory(mutate: (draft: CapabilityInventory) => void): CapabilityInventory {
  const draft: CapabilityInventory = JSON.parse(JSON.stringify(parsedInventory)) as CapabilityInventory;
  mutate(draft);
  return draft;
}

const closureFacts: CapabilityClosureFacts = {
  completedThrough: await runtimeCompletedThrough(),
  repoPaths: repoPathIndex(),
  npmScripts: new Set(Object.keys(packageJson.scripts)),
  legacyPathExists: (path) => frozenLegacyPaths(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE.capabilities.legacyPaths).includes(path),
};

function entryOf(draft: CapabilityInventory, id: string): CapabilityEntry {
  const entry = draft.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`fixture names an unknown capability entry: ${id}`);
  return entry;
}

describe("D58 legacy capability disposition", () => {
  it("covers every reviewed capability surface exactly once", () => {
    const owned = parsedInventory.entries.flatMap(({ sourcePaths }) => sourcePaths).sort();
    assert.equal(new Set(owned).size, owned.length, "a legacy capability path is owned more than once");
    assert.deepEqual(owned, discoveredCapabilityPaths());
  });

  it("keeps entries strict, evidenced, and proxy-free", () => {
    const ids = parsedInventory.entries.map(({ id }) => id);
    assert.equal(new Set(ids).size, ids.length, "capability ids must be unique");
    assert.equal(parsedInventory.proxyDispositionAllowed, false);
    // `proxy` is not in the disposition union at all after D184 — the schema
    // is the enforcement, and this asserts the union stayed closed.
    assert.throws(
      () => DispositionSchema.parse({ kind: "proxy", milestone: "2i" }),
      /invalid|expected|union/iu,
    );
    for (const entry of parsedInventory.entries) {
      for (const path of entry.sourcePaths) assert.ok(closureFacts.legacyPathExists(path), path);
    }
  });

  it("closes every disposition against the as-built (D184)", () => {
    assert.deepEqual(auditCapabilityClosure(parsedInventory, closureFacts), []);
  });

  it("leaves no entry open on a milestone the runtime already completed (D184)", () => {
    const completedIndex = MILESTONE_ORDER.indexOf(closureFacts.completedThrough);
    const stranded = parsedInventory.entries.filter(
      (entry) => entry.status === "open" && MILESTONE_ORDER.indexOf(entry.ownerMilestone) <= completedIndex,
    );
    assert.deepEqual(stranded.map(({ id }) => id), []);
    // Non-vacuity: the sweep must actually be looking at completed milestones.
    assert.ok(completedIndex > 0, "the runtime reports no completed milestone; the sweep would be vacuous");
    assert.ok(
      parsedInventory.entries.some((entry) => MILESTONE_ORDER.indexOf(entry.ownerMilestone) <= completedIndex),
      "no entry is owned by a completed milestone; the sweep would be vacuous",
    );
  });

  it("never blocks the phase marker's next advance (D184)", () => {
    // `cutoverRequiresZeroOpen` gates CUTOVER — doc 05 §Exit criteria's whole-program flip
    // — not a Phase-2 tail. An entry left sitting on a tail is therefore a
    // record-keeping defect that must never become a gate on the program's own
    // progress, so the sweep is run AHEAD against every base work item through
    // 2j, the last of them. This is what makes advancing the marker in
    // `src/core/runtime-composition.ts` a one-line change rather than an
    // archaeology exercise.
    for (const completedThrough of MILESTONE_ORDER.slice(0, MILESTONE_ORDER.indexOf("2j") + 1)) {
      assert.deepEqual(
        auditCapabilityClosure(parsedInventory, { ...closureFacts, completedThrough }),
        [],
        `the inventory would block a phase marker reporting completedThrough ${completedThrough}`,
      );
    }
  });

  describe("negative controls — the audit fails when it should", () => {
    it("catches a status that disagrees with its disposition", () => {
      const drifted = fixtureInventory((draft) => {
        entryOf(draft, "legacy-service-ocr").status = "open";
      });
      assert.deepEqual(auditCapabilityClosure(drifted, closureFacts).slice(0, 1), [
        "legacy-service-ocr: disposition native requires status implemented, found open",
      ]);
    });

    it("catches an ownerMilestone that disagrees with the disposition that decided it", () => {
      const drifted = fixtureInventory((draft) => {
        entryOf(draft, "legacy-service-ocr").ownerMilestone = "2j";
      });
      assert.ok(
        auditCapabilityClosure(drifted, closureFacts).includes(
          "legacy-service-ocr: ownerMilestone 2j disagrees with its native disposition's milestone 2h",
        ),
      );
    });

    it("catches a native target that resolves to nothing", () => {
      const drifted = fixtureInventory((draft) => {
        entryOf(draft, "legacy-route-hub").disposition = {
          kind: "native",
          milestone: "1g-spine",
          targetIds: ["src/server/dashboard/subscriptions/dashboard-stream.ts", "src/server/dashboard/subscriptions/ghost.ts"],
        };
      });
      assert.ok(
        auditCapabilityClosure(drifted, closureFacts).includes(
          "legacy-route-hub: native target src/server/dashboard/subscriptions/ghost.ts is not a git-visible path in this repo",
        ),
      );
    });

    it("catches a replaced target that resolves to nothing", () => {
      const drifted = fixtureInventory((draft) => {
        entryOf(draft, "legacy-tool-main-module").disposition = {
          kind: "replaced",
          milestone: "1a",
          replacement: "scripts/main-module.ts",
          differencesAccepted: "unchanged",
        };
      });
      assert.ok(
        auditCapabilityClosure(drifted, closureFacts).includes(
          "legacy-tool-main-module: replaced target scripts/main-module.ts is not a git-visible path in this repo",
        ),
      );
    });

    it("catches an entry left open on a completed milestone", () => {
      const drifted = fixtureInventory((draft) => {
        const entry = entryOf(draft, "legacy-service-address");
        entry.disposition = { kind: "open", milestone: "2h", reason: "pretending nobody built it" };
        entry.status = "open";
      });
      assert.ok(
        auditCapabilityClosure(drifted, closureFacts).some((violation) =>
          violation.startsWith("legacy-service-address: still open while its owner 2h is at or before the runtime's completedThrough")
        ),
        auditCapabilityClosure(drifted, closureFacts).join("\n"),
      );
    });

    it("catches evidence naming an npm script package.json does not have", () => {
      const drifted = fixtureInventory((draft) => {
        entryOf(draft, "legacy-dashboard-queue-panel").verificationEvidence = [
          "legacy-source-present:src/dashboard/components/queue-panel",
          "npm run test:parity:everything",
        ];
      });
      assert.ok(
        auditCapabilityClosure(drifted, closureFacts).includes(
          'legacy-dashboard-queue-panel: evidence "npm run test:parity:everything" names no script in package.json',
        ),
      );
    });

    it("catches evidence naming a rebuild path that does not exist", () => {
      const drifted = fixtureInventory((draft) => {
        entryOf(draft, "legacy-dashboard-queue-panel").verificationEvidence = [
          "legacy-source-present:src/dashboard/components/queue-panel",
          "src/dashboard/surfaces/queue-panel.tsx",
        ];
      });
      assert.ok(
        auditCapabilityClosure(drifted, closureFacts).some((violation) =>
          violation.startsWith('legacy-dashboard-queue-panel: evidence "src/dashboard/surfaces/queue-panel.tsx" resolves to nothing')
        ),
      );
    });

    it("catches evidence naming a legacy path that does not exist", () => {
      const drifted = fixtureInventory((draft) => {
        entryOf(draft, "legacy-dashboard-queue-panel").verificationEvidence = [
          "legacy-source-present:src/dashboard/components/queue-panel-v2",
          "src/dashboard/surfaces/queue.tsx",
        ];
      });
      assert.ok(
        auditCapabilityClosure(drifted, closureFacts).includes(
          'legacy-dashboard-queue-panel: evidence "legacy-source-present:src/dashboard/components/queue-panel-v2" names a legacy path that does not exist',
        ),
      );
    });

    it("catches a decided entry whose only evidence is that legacy still exists", () => {
      const drifted = fixtureInventory((draft) => {
        entryOf(draft, "legacy-dashboard-queue-panel").verificationEvidence = [
          "legacy-source-present:src/dashboard/components/queue-panel",
        ];
      });
      assert.ok(
        auditCapabilityClosure(drifted, closureFacts).includes(
          "legacy-dashboard-queue-panel: a native entry must cite at least one rebuild path or npm script as evidence; legacy-source-present alone proves nothing about this repo",
        ),
      );
    });

    it("refuses an open disposition with no reason, and a retirement with no evidence", () => {
      assert.throws(() => DispositionSchema.parse({ kind: "open", milestone: "2i" }), /reason/iu);
      assert.throws(
        () => DispositionSchema.parse({ kind: "retired", milestone: "2i", reason: "because", evidence: [] }),
        /evidence|small|least/iu,
      );
      assert.throws(
        () => DispositionSchema.parse({ kind: "candidateForRetirement", milestone: "2i", evidence: ["x"], requiresOperatorAuthorization: false }),
        /requiresOperatorAuthorization|true|literal/iu,
      );
      assert.throws(() => MilestoneSchema.parse("2k"), /invalid|expected|option/iu);
    });
  });
});
