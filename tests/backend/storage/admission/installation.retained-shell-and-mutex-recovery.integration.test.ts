import { createInstallationControlTestWorld } from "../../../support/helpers/backend/installation-control-world.js";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireInstallation } from "../../../../src/backend/storage/admission/installation.js";

const {fixture, restore, adoptSynthetic, relocationPlan, prepareDestination, staged, cleanup } = createInstallationControlTestWorld();
afterEach(cleanup);

it("refuses a duplicate managed entry in a partially retained lock shell", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  prepareDestination(lease, destination);
  lease.recordVerifiedStage(staged(lease, destination, operationId, plan));
  lease.fenceRelocationSource();
  const journalPath = join(workspace, ".tracker/control", "journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Record<string, unknown>;
  writeFileSync(journalPath, JSON.stringify({ ...journal, phase: "retaining" }), { mode: 0o600 });
  const retained = join(workspace, ".tracker", `.data.retained-${operationId}-state`);
  mkdirSync(retained, { mode: 0o700 });
  copyFileSync(join(pair.stateRoot, ".runtime-owner.json"), join(retained, ".runtime-owner.json"));
  copyFileSync(join(pair.stateRoot, ".runtime-source-fence.json"), join(retained, ".runtime-source-fence.json"));
  copyFileSync(join(pair.stateRoot, "state.db"), join(retained, "state.db"));
  expect(() => lease.retainRelocationSources()).toThrow(/duplicate retained managed entry|tombstone/u);
  expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toBe("source");
  lease.release(); held.release();
});

it("recovers empty and first-witness retained shells, but refuses foreign entries", () => {
  for (const partial of ["empty", "marker", "foreign"] as const) {
    const { workspace, pair } = fixture();
    const initial = adoptSynthetic(workspace, pair); initial.release();
    writeFileSync(join(pair.stateRoot, "state.db"), "source");
    writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
    const lease = acquireInstallation(workspace, "exclusive");
    const held = restore(workspace);
    const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
    const plan = relocationPlan(lease, destination);
    const operationId = lease.beginRelocation(destination, plan, held);
    prepareDestination(lease, destination);
    const verify = staged(lease, destination, operationId, plan);
    lease.recordVerifiedStage(verify);
    lease.fenceRelocationSource();
    const journalPath = join(workspace, ".tracker/control", "journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Record<string, unknown>;
    writeFileSync(journalPath, JSON.stringify({ ...journal, phase: "retaining" }), { mode: 0o600 });
    const retained = join(workspace, ".tracker", `.data.retained-${operationId}-state`);
    mkdirSync(retained, { mode: 0o700 });
    if (partial === "marker") copyFileSync(join(pair.stateRoot, ".runtime-owner.json"), join(retained, ".runtime-owner.json"));
    if (partial === "foreign") writeFileSync(join(retained, "foreign"), "unknown");
    lease.release(); held.release();
    const recoveredHeld = restore(workspace);
    const recovered = acquireInstallation(workspace, "exclusive", { recoverRelocation: {
      installationId: initial.locator.installationId, fromGeneration: 0, operationId, restoreAdmission: recoveredHeld,
    } });
    if (partial === "foreign") {
      expect(() => recovered.retainRelocationSources()).toThrow(/ambiguous retained shell/u);
      expect(readFileSync(join(pair.stateRoot, "state.db"), "utf8")).toBe("source");
    } else {
      recovered.retainRelocationSources();
      recovered.switchRelocationLocator(verify);
      recovered.settleRelocation(verify);
      expect(existsSync(join(workspace, ".tracker/control", "journal.json"))).toBe(false);
    }
    recovered.release(); recoveredHeld.release();
  }
});

it("refuses unknown managed state entries before source fencing", () => {
  const { workspace, pair } = fixture();
  const initial = adoptSynthetic(workspace, pair); initial.release();
  writeFileSync(join(pair.stateRoot, "state.db"), "source");
  writeFileSync(join(pair.artifactRoot, "a.artifact"), "artifact");
  const lease = acquireInstallation(workspace, "exclusive");
  const held = restore(workspace);
  const destination = { stateRoot: join(dirname(workspace), "new-state"), artifactRoot: join(dirname(workspace), "new-artifacts") };
  const plan = relocationPlan(lease, destination);
  const operationId = lease.beginRelocation(destination, plan, held);
  prepareDestination(lease, destination);
  const verify = staged(lease, destination, operationId, plan);
  writeFileSync(join(pair.stateRoot, "unlisted.log"), "unknown");
  expect(() => lease.recordVerifiedStage(verify)).toThrow(/managed state entry membership mismatch/u);
  expect(existsSync(join(pair.stateRoot, ".runtime-source-fence.json"))).toBe(false);
  lease.release(); held.release();
});
