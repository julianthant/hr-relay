import { createStepOmissionTestWorld } from "../../../support/helpers/backend/step-omission-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { BrowserLoginError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { buildNodeFailureRecord } from "../../../../src/backend/runtime/execution/run-failure.js";
import { buildExplainRunView, renderExplainRun } from "../../../../src/backend/runs/explain/explain-run.js";
import { NodeIdSchema, TaskIdSchema } from "../../../../src/rules/identity/ids.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { RunLifecycleSchema, RunPauseSchema, RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { timelineCheckpointReference, TimelineCheckpointReferenceSchema } from "../../../../src/models/events/timeline.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { SIGN_IN_REFUSAL_PROBES } from "../../../support/fixtures/sign-in-refusal-probes.js";

const {STEP, TYPED_FACT, omittedStepFixture, cleanup } = createStepOmissionTestWorld();


afterEach(cleanup);

describe("explain run checkpoint attribution", () => {
  function checkpointEvidence() {
    const run = RunRecordSchema.parse({ ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, runId: "bbbbbbbb-0000-4000-8000-000000000001", attempt: 2 },
      claimGeneration: 1 });
    const earlier = RunCheckpointRecordSchema.parse({
      workflowId: run.envelope.workflow, itemId: run.envelope.itemId, nodeId: "searching",
      runId: QUEUED_RUN.envelope.runId, attempt: 1, claimGeneration: 1,
      descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
      implFingerprint: "c".repeat(64), output: { schemaHash: "a".repeat(64), value: { found: true } },
      provenance: [], writtenAt: run.createdAt,
    });
    const observed = RunCheckpointRecordSchema.parse({ ...earlier, runId: run.envelope.runId, attempt: 2 });
    const unreached = RunCheckpointRecordSchema.parse({ ...earlier, nodeId: "cross-verify" });
    return { run, earlier, observed, unreached };
  }

  it("shows no record for an unreached step even when an earlier run wrote its checkpoint", () => {
    const { run, earlier, unreached, observed } = checkpointEvidence();
    const view = buildExplainRunView({ run, checkpoints: [earlier, unreached, observed], writes: [],
      nodeIds: ["searching", "cross-verify"], dependencies: [] });

    assert.deepEqual(view.timeline.map(entry => [entry.nodeId, entry.disposition]), [
      ["searching", "observed-this-attempt"], ["cross-verify", "no-record"],
    ]);
  });

  it("names the exact checkpoint a Retry replayed even when another run wrote a newer row", () => {
    const { run, earlier, unreached } = checkpointEvidence();
    const newer = RunCheckpointRecordSchema.parse({ ...earlier,
      runId: "cccccccc-0000-4000-8000-000000000001", attempt: 3 });
    const evidence = { run: { ...run, envelope: { ...run.envelope, retryOf: earlier.runId } },
      checkpoints: [earlier, unreached, newer], replayedCheckpoints: [TimelineCheckpointReferenceSchema.parse(timelineCheckpointReference(earlier))],
      writes: [], nodeIds: ["searching", "cross-verify"], dependencies: [] };
    const view = buildExplainRunView(evidence);

    assert.equal(view.timeline[0]?.disposition, "replayed-from-checkpoint");
    assert.match(view.timeline[0]?.detail ?? "", new RegExp(`run ${earlier.runId} attempt 1`, "u"));
    assert.equal(view.timeline[1]?.disposition, "no-record");
  });

  it.each([
    { runId: "cccccccc-0000-4000-8000-000000000001" },
    { attempt: 2 },
    { claimGeneration: 2 },
    { writtenAt: "2026-08-04T00:00:00.000Z" },
    { outputDigest: "d".repeat(64) },
    { itemId: "dddddddd-0000-4000-8000-000000000001" },
    { workflowId: "separations" },
    { nodeId: "cross-verify" },
  ])("requires an exact replay reference, including %j", (changed) => {
    const { run, earlier } = checkpointEvidence();
    const view = buildExplainRunView({ run, checkpoints: [earlier], writes: [], dependencies: [],
      nodeIds: ["searching"], replayedCheckpoints: [TimelineCheckpointReferenceSchema.parse({ ...timelineCheckpointReference(earlier), ...changed })] });

    assert.equal(view.timeline[0]?.disposition, "no-record");
  });

  it("keeps earlier claims and gate answers inside the same run attributed as before", () => {
    const { run, observed, unreached } = checkpointEvidence();
    const gate = RunCheckpointRecordSchema.parse({ ...observed, nodeId: "review", claimGeneration: 2 });
    const view = buildExplainRunView({ run: RunRecordSchema.parse({ ...run, claimGeneration: 2 }),
      checkpoints: [unreached, observed, gate], writes: [], nodeIds: ["searching", "review", "cross-verify"],
      dependencies: [{ nodeId: "cross-verify", state: "condition-false" }] });

    assert.deepEqual(view.timeline.map(entry => [entry.nodeId, entry.disposition]), [
      ["searching", "replayed-from-checkpoint"], ["review", "observed-this-attempt"], ["cross-verify", "not-run"],
    ]);
    assert.equal(view.timeline[2]?.detail, "closed reason: condition-false");
  });
});

describe("explain run under step omission", () => {
  async function explainView() {
    const fixture = await omittedStepFixture();
    return buildExplainRunView({
      run: fixture.run,
      checkpoints: fixture.checkpoints,
      writes: [],
      nodeIds: fixture.result.dependencies.map((dependency) => String(dependency.nodeId)),
      dependencies: fixture.result.dependencies.map((dependency) => ({
        nodeId: String(dependency.nodeId),
        state: dependency.state === "not-run" ? dependency.reason : dependency.state,
      })),
    });
  }

  it("lists the omitted step keys and renders them as their own section", async () => {
    const view = await explainView();
    assert.deepEqual(view.omittedSteps, [STEP]);
    const rendered = renderExplainRun(view);
    assert.match(rendered, /omitted steps\n\s+crm-read — omitted at start/u);
    assert.equal(rendered.includes(TYPED_FACT), false);
  });
});

function refusedFailure(detail: string, observedUrl: string, check?: "application-route") {
  const login = new BrowserLoginError("ucpath", "verify-landing", detail, observedUrl, undefined, undefined, check);
  const taskId = TaskIdSchema.parse("ucpath/search-person-org");
  return buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", nodeId: NodeIdSchema.parse("searching"), taskId,
    error: new TaskError(taskId, login.code, login.message, { cause: login }), occurredAt: QUEUED_RUN.createdAt });
}

function renderRefusal(detail: string, observedUrl: string, check?: "application-route", protectedRun = false) {
  const failure = refusedFailure(detail, observedUrl, check);
  const run = protectedRun ? RunRecordSchema.parse({
    ...QUEUED_RUN,
    input: { ...QUEUED_RUN.input, parsed: { ...QUEUED_RUN.input.parsed, protectedBindings: [{
      kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: "00000000-0000-4000-8000-000000000099",
    }] } },
  }) : RunRecordSchema.parse(QUEUED_RUN);
  return renderExplainRun(buildExplainRunView({ run, checkpoints: [], writes: [], nodeIds: [], dependencies: [], failure }));
}

it("explains a refused sign-in with the check and the registry page", () => {
  const rendered = renderRefusal("the check saw employee 10456712", "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO?EMPLID=10456712#frag-canary", "application-route");
  assert.match(rendered, /UCPath sign-in failed\./);
  assert.match(rendered, /sign-in check verify-landing: application-route/);
  assert.match(rendered, /page https:\/\/a5\.ucsd\.edu\/tritON\/profile\/SAML2\/Redirect\/SSO/);
  assert.equal(rendered.includes("10456712"), false);
  assert.equal(rendered.includes("frag-canary"), false);
});

it("explains a sign-in step when the verifier named no check", () => {
  const rendered = renderRefusal("the check saw employee 10456712", "https://a5.ucsd.edu/sso");
  assert.match(rendered, /sign-in step verify-landing/);
  assert.match(rendered, /page https:\/\/a5\.ucsd\.edu \(path not listed\)/);
  assert.equal(rendered.includes("sign-in check"), false);
  assert.equal(rendered.includes("10456712"), false);
});

it("explains an unlisted, unread, or unreadable page", () => {
  assert.match(renderRefusal("the check refused", "https://example.test/read?token=QUERY_CANARY"), /page not listed/);
  assert.match(renderRefusal("the check refused", ""), /page not read/);
  assert.match(renderRefusal("the check refused", "not a url"), /page unreadable/);
  for (const rendered of [
    renderRefusal("the check refused", "https://example.test/read?token=QUERY_CANARY"),
    renderRefusal("the check refused", ""),
    renderRefusal("the check refused", "not a url"),
  ]) {
    assert.equal(rendered.includes("QUERY_CANARY"), false);
    assert.equal(rendered.includes("not a url"), false);
  }
});

it("explains a protected run's refused sign-in from the closed leaves", () => {
  const rendered = renderRefusal(
    "the check saw employee 10456712 password=SECRET_CANARY",
    "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/app?EMPLID=10456712#frag-canary",
    "application-route",
    true,
  );
  assert.match(rendered, /UCPath sign-in failed\./);
  assert.match(rendered, /sign-in check verify-landing: application-route/);
  assert.match(rendered, /page https:\/\/ucphrprdpub\.universityofcalifornia\.edu\/psc\/ucphrprd\/EMPLOYEE\/HRMS\//);
  assert.equal(rendered.includes("10456712"), false);
  assert.equal(rendered.includes("frag-canary"), false);
  assert.equal(rendered.includes("SECRET_CANARY"), false);
  assert.equal(rendered.includes("EMPLID"), false);
});

it("explains every probe without copying its text", () => {
  for (const row of SIGN_IN_REFUSAL_PROBES) {
    const rendered = renderRefusal(row.detail, row.observedUrl, undefined, true);
    for (const canary of row.canaries) assert.equal(rendered.includes(canary), false, `${row.name} ${canary}`);
  }
});

describe("explain run next safe action", () => {
  it("explains a run that is both pausing and stopping by its stop, as every other reader does", async () => {
    const fixture = await omittedStepFixture();
    const at = fixture.run.lifecycle.state === "terminal" ? fixture.run.lifecycle.endedAt : fixture.run.updatedAt;
    const { completion: _completion, ...unsettled } = fixture.run;
    const running = { ...unsettled, lifecycle: RunLifecycleSchema.parse({ state: "running", workerId: "person-lookup-worker-1", claimedAt: at, heartbeatAt: at }) };
    const pause = RunPauseSchema.parse({ state: "requested", commandId: "a1000000-0000-4000-8000-000000000090", requestedAt: at });
    const nextOf = (run: typeof running) => buildExplainRunView({ run, checkpoints: fixture.checkpoints, writes: [],
      nodeIds: [], dependencies: [] }).nextSafeAction;
    assert.match(nextOf({ ...running, pause }), /A pause is requested/u);
    assert.equal(nextOf({ ...running, pause, cancelRequested: true }), nextOf({ ...running, cancelRequested: true }));
    assert.doesNotMatch(nextOf({ ...running, pause, cancelRequested: true }), /pause/u);
  });
});
