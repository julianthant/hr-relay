
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { planStart } from "../../../src/backend/runs/start/plan.js";
import { parseInputRunText,toRawSubmission } from "../../../src/models/workflow/ingress.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { HASH_A,NOW,UUID_4 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import {
type DashboardWorld
} from "../../support/helpers/backend/dashboard-harness.js";
import { protectedSecretSource } from "../../support/helpers/protected-secret-source.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";

const CLOCK = manualClock(new Date(NOW));

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
const worlds: DashboardWorld[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
  for (const world of worlds.splice(0)) world.dispose();
});

function openDatabase(): AuthorityDatabase {
  const root = mkdtempSync(join(tmpdir(), "hrauto-separations-wire-"));
  roots.push(root);
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  databases.push(database);
  return database;
}

function plan(submissions: readonly unknown[], dryRun = false) {
  return planStart(
    { protectedSecrets: protectedSecretSource({ timekeeperName: "Synthetic Timekeeper" }), authority: openDatabase(), clock: CLOCK, ids: sequentialIdFactory(), planTtlMs: 600_000 },
    {
      descriptor: separationsDescriptor,
      submissions,
      dryRun,
      priority: "bulk" as const,
      shape: "single" as const,
      configFingerprint: HASH_A,
      configSnapshotId: UUID_4,
      plannedBy: "local-operator",
    },
  );
}

describe("separations — start planning through the existing service", () => {


  it("plans a run from typed text alone", () => {
    const surface = separationsDescriptor.surfaces.inputRun;
    assert.ok(surface, "separations declares a typed-text start surface");
    const entries = parseInputRunText(surface.parser, "4502; 4510");
    assert.equal(entries.length, 2);
    const planned = plan(entries.map((entry) => toRawSubmission(entry)));
    assert.equal(planned.refused.length, 0);
    assert.deepEqual(planned.planned.map(({ matchKey }) => matchKey), [
      "separations:4502",
      "separations:4510",
    ]);
    // Browser submissions carry only the typed document number.
    assert.deepEqual(toRawSubmission(entries[0]), {
      documentNumber: "4502",
    });
  });

  it("refuses typed text that is not a document number, and starts nothing", () => {
    const surface = separationsDescriptor.surfaces.inputRun;
    assert.ok(surface);
    // No `otherwise` arm: the box refuses as a WHOLE rather than starting the
    // good half of a paste, which is what `inputRunParserLabel` promises.
    assert.throws(() => parseInputRunText(surface.parser, "4502; Cramia, Dreitho"), /matched no parser rule/u);
  });
});
