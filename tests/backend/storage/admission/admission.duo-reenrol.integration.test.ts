import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { DuoReenrolOperationSchema } from "../../../../src/models/profiles/profile.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { finishProfileOnboarding, syntheticOnboardingDuo } from "../../../support/helpers/admission-fixture.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";

const AT = "2026-10-21T12:00:00.000Z";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

it("lets a stopped repair claim a profile whose re-enrolment is uncommitted, and refuses it once a commit intent is recorded", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "duo-reenrol-repair-")));
  cleanups.push(() => rmSync(workspace, { recursive: true, force: true }));
  const lifetime = await runtimeLifetimeLock(), clock = manualClock(new Date(AT));
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  mkdirSync(join(workspace, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const runtime = composeProfileRuntime({ onboardingDuo: syntheticOnboardingDuo(), admission: machine, clock, hostFacts: { primaryDisplay: null } });
  let opened: { operationId: string; profileId: string };
  try {
    const active = await finishProfileOnboarding(runtime.session, runtime.session.signUp({ firstName: "Synthetic", lastName: "Operator",
      email: "repair@ucsd.edu", password: "synthetic-repair-password", createdAt: AT }));
    assert.ok(active.state === "active");
    opened = runtime.session.beginDuoReenrol(active.token);
  } finally { await runtime.close("shutdown"); machine.release(); }

  const repairClaim = () => {
    const stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace, lifetime);
    try { stopped.admitStoppedProfileRepair(opened.profileId, stopped.maintenanceOperation()).release(); } finally { stopped.release(); }
  };
  repairClaim();

  const exclusive = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  try {
    const operation = DuoReenrolOperationSchema.parse(JSON.parse(readFileSync(join(exclusive.stateRoot, "machine", "operations", `${opened.operationId}.json`), "utf8")));
    exclusive.publishProfileOperation({ ...operation, commit: { commitId: randomUUID(), accountId: operation.draft.accountId, duoRevision: 1,
      stagedIds: ["synthetic-staged"], retireIds: ["synthetic-retired"], mac: "c".repeat(64) } });
  } finally { exclusive.release(); }
  assert.throws(repairClaim, /profile-storage-claim-unavailable/u);
});
