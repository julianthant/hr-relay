import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { claimWithPreflight } from "../../../../../src/backend/app/preflight/worker-admission.js";
import { admitOcrRunResources } from "../../../../../src/backend/runs/lifecycle/ocr-checkpoint-publication.js";
import { requiredPreflightChecks } from "../../../../../src/models/preflight/preflight.js";
import type { RunRecord } from "../../../../../src/models/run/record.js";
import { PREFLIGHT_CHECKS } from "../../../../../src/models/runtime/runtime-dependencies.js";
import { createPreflightAdmission, PreflightAdmissionScopeSchema } from "../../../../../src/rules/preflight/preflight-admission.js";
import { testAdmittedWorker, testWorkerLifetime } from "../../../../support/fixtures/run-lifecycle-fixtures.js";
import { createOcrReviewWorld } from "../../../../support/helpers/backend/ocr-review-world.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("a worker that loses an OCR page claim race claims the next page instead of failing", async () => {
  const f = await world.fixture({ pageCount: 2, holdPages: true });
  const repositories = f.database.authority;
  const pages = () => repositories.runs.listChildren(f.run.envelope.runId).filter(child => child.envelope.workflow === "ocr-page");
  assert.deepEqual(pages().map(page => page.lifecycle.state), ["queued", "queued"]);
  const workerB = testWorkerLifetime(f.database, "ocr", 1).workerId;
  const workerA = testAdmittedWorker(f.database, f.clock, { path: f.path, workflow: "ocr", poolIndex: 2, browserSystems: [] }).workerId;
  const scope = PreflightAdmissionScopeSchema.parse({ configSnapshotId: f.run.envelope.configSnapshotId, configFingerprint: f.run.envelope.configFingerprint,
    descriptorFingerprint: f.run.envelope.contractFingerprint, requestedCapabilities: ["executor.run"] });
  const admission = createPreflightAdmission({ clock: f.clock, scheduler: f.harness.scheduler, validate() {},
    runners: () => PREFLIGHT_CHECKS.filter(spec => requiredPreflightChecks(["executor.run"]).includes(spec.id)).map(spec => ({ check: spec.id, kind: spec.runner,
      async run() { return { check: spec.id, state: "healthy" as const, summary: "Fixture healthy" }; } })) });
  const preflight = { admission, currentScope: () => scope, runScope: () => scope, descriptor: () => f.root.descriptor,
    prepareSession: async () => { throw new Error("no browser session prepares in this race"); } };
  const runtime = repositories.runtimeConfig.get(); assert.ok(runtime);
  const claim = (workerId: string) => (admit: (run: RunRecord) => void) => f.canonical.lifecycle.claimNext({ commandId: randomUUID(), workflow: "ocr", workerId,
    runtimeConfig: { generation: runtime.generation, settingsRevision: runtime.settingsRevision, settingsFingerprint: runtime.settingsFingerprint,
      configFingerprint: runtime.configFingerprint } }, admit);
  const candidateCurrent = (run: RunRecord) => repositories.runs.get(run.envelope.runId)?.version === run.version;
  // The production preparation: run resources admit the captured OCR candidate against the stored run.
  const admitResources = (run: RunRecord) => { f.database.withAuthorityReadSnapshot(() => admitOcrRunResources(repositories, f.canonical.lifecycle, run)); };
  const prepared: string[] = [];
  let racedPage: string | undefined;
  const claimedByA = await claimWithPreflight({ preflight, signal: new AbortController().signal, candidateCurrent, claim: claim(workerA),
    prepareRun: async run => {
      prepared.push(run.envelope.runId);
      if (racedPage === undefined) {
        const claimedByB = await claimWithPreflight({ preflight, signal: new AbortController().signal, candidateCurrent, claim: claim(workerB),
          prepareRun: async raced => { admitResources(raced); } });
        assert.ok(claimedByB.state === "applied" && "run" in claimedByB, JSON.stringify(claimedByB));
        racedPage = claimedByB.run.envelope.runId;
        assert.equal(racedPage, run.envelope.runId);
      }
      admitResources(run);
    } });
  assert.ok(claimedByA.state === "applied" && "run" in claimedByA, JSON.stringify(claimedByA));
  assert.equal(claimedByA.run.envelope.workflow, "ocr-page");
  assert.notEqual(claimedByA.run.envelope.runId, racedPage);
  assert.deepEqual(prepared, [racedPage, claimedByA.run.envelope.runId]);
  assert.deepEqual(pages().map(page => page.lifecycle.state === "claimed" ? page.lifecycle.workerId : page.lifecycle.state).sort(), [workerA, workerB].sort());
});
