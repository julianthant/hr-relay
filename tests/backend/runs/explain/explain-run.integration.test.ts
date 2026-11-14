import { createStepOmissionTestWorld } from "../../../support/helpers/backend/step-omission-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { BrowserLoginError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { buildNodeFailureRecord } from "../../../../src/backend/runtime/execution/run-failure.js";
import { buildExplainRunView, renderExplainRun } from "../../../../src/backend/runs/explain/explain-run.js";
import { NodeIdSchema, TaskIdSchema } from "../../../../src/rules/identity/ids.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { timelineCheckpointReference, TimelineCheckpointReferenceSchema } from "../../../../src/models/events/timeline.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

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

it("explains a refused sign-in with the check and the page, and leaves the query out", () => {
  const reason = "the login could not prove the authenticated application: the observed URL is not a UCPath PeopleSoft application route";
  const login = new BrowserLoginError("ucpath", "verify-landing", reason, "https://ucpath.universityofcalifornia.edu/?EMPLID=10456712#frag-canary");
  const taskId = TaskIdSchema.parse("ucpath/search-person-org");
  const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", nodeId: NodeIdSchema.parse("searching"), taskId,
    error: new TaskError(taskId, login.code, login.message, { cause: login }), occurredAt: QUEUED_RUN.createdAt });
  const view = buildExplainRunView({ run: RunRecordSchema.parse(QUEUED_RUN), checkpoints: [], writes: [], nodeIds: [], dependencies: [], failure });
  const rendered = renderExplainRun(view);
  assert.match(rendered, /UCPath sign-in failed\./);
  assert.match(rendered, new RegExp(`sign-in check verify-landing: ${reason}`));
  assert.match(rendered, /page https:\/\/ucpath\.universityofcalifornia\.edu\//);
  assert.equal(rendered.includes("10456712"), false);
  assert.equal(rendered.includes("frag-canary"), false);
});

it("explains a protected run's refused sign-in without the query", () => {
  const reason = "the login could not prove the authenticated application: UCPath PeopleSoft never issued its PS_TOKEN session cookie for universityofcalifornia.edu";
  const login = new BrowserLoginError("ucpath", "verify-landing", reason, "https://ucpath.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/app?EMPLID=10456712#frag-canary");
  const taskId = TaskIdSchema.parse("ucpath/search-person-org");
  const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", nodeId: NodeIdSchema.parse("searching"), taskId,
    error: new TaskError(taskId, login.code, login.message, { cause: login }), occurredAt: QUEUED_RUN.createdAt });
  const run = RunRecordSchema.parse({
    ...QUEUED_RUN,
    input: { ...QUEUED_RUN.input, parsed: { ...QUEUED_RUN.input.parsed, protectedBindings: [{
      kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: "00000000-0000-4000-8000-000000000099",
    }] } },
  });
  const rendered = renderExplainRun(buildExplainRunView({ run, checkpoints: [], writes: [], nodeIds: [], dependencies: [], failure }));
  assert.match(rendered, /UCPath sign-in failed\./);
  assert.match(rendered, new RegExp(`sign-in check verify-landing: ${reason}`));
  assert.match(rendered, /page https:\/\/ucpath\.universityofcalifornia\.edu\/psc\/ucphrprd\/EMPLOYEE\/HRMS\/c\/app/);
  assert.equal(rendered.includes("10456712"), false);
  assert.equal(rendered.includes("frag-canary"), false);
  assert.equal(rendered.includes("EMPLID"), false);
});

it("explains a protected run without an uppercase URL query from the verifier reason", () => {
  const login = new BrowserLoginError("ucpath", "verify-landing",
    "the check saw HTTPS://example.test/read?EMPLID=10456712#frag-canary",
    "https://example.test/other");
  const taskId = TaskIdSchema.parse("ucpath/search-person-org");
  const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", nodeId: NodeIdSchema.parse("searching"), taskId,
    error: new TaskError(taskId, login.code, login.message, { cause: login }), occurredAt: QUEUED_RUN.createdAt });
  const run = RunRecordSchema.parse({
    ...QUEUED_RUN,
    input: { ...QUEUED_RUN.input, parsed: { ...QUEUED_RUN.input.parsed, protectedBindings: [{
      kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: "00000000-0000-4000-8000-000000000099",
    }] } },
  });
  const rendered = renderExplainRun(buildExplainRunView({ run, checkpoints: [], writes: [], nodeIds: [], dependencies: [], failure }));
  assert.match(rendered, /sign-in check verify-landing: the check saw https:\/\/example\.test\/read/);
  assert.equal(rendered.includes("10456712"), false);
  assert.equal(rendered.includes("frag-canary"), false);
});

it("explains a protected run without an employee id in the reason or the page path", () => {
  const login = new BrowserLoginError("ucpath", "verify-landing",
    "the check refused employee 10456712", "https://example.test/people/10456712");
  const taskId = TaskIdSchema.parse("ucpath/search-person-org");
  const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", nodeId: NodeIdSchema.parse("searching"), taskId,
    error: new TaskError(taskId, login.code, login.message, { cause: login }), occurredAt: QUEUED_RUN.createdAt });
  const run = RunRecordSchema.parse({
    ...QUEUED_RUN,
    input: { ...QUEUED_RUN.input, parsed: { ...QUEUED_RUN.input.parsed, protectedBindings: [{
      kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: "00000000-0000-4000-8000-000000000099",
    }] } },
  });
  const rendered = renderExplainRun(buildExplainRunView({ run, checkpoints: [], writes: [], nodeIds: [], dependencies: [], failure }));
  assert.match(rendered, /sign-in check verify-landing: the check refused employee \[removed\]/);
  assert.match(rendered, /page https:\/\/example\.test\/people\/\[removed\]/);
  assert.equal(rendered.includes("10456712"), false);
});

it("explains a protected run without a percent-encoded employee id", () => {
  const encoded = "%31%30%34%35%36%37%31%32";
  const login = new BrowserLoginError("ucpath", "verify-landing",
    `the check saw https://example.test/people/${encoded}`, `https://example.test/people/${encoded}`);
  const taskId = TaskIdSchema.parse("ucpath/search-person-org");
  const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", nodeId: NodeIdSchema.parse("searching"), taskId,
    error: new TaskError(taskId, login.code, login.message, { cause: login }), occurredAt: QUEUED_RUN.createdAt });
  const run = RunRecordSchema.parse({
    ...QUEUED_RUN,
    input: { ...QUEUED_RUN.input, parsed: { ...QUEUED_RUN.input.parsed, protectedBindings: [{
      kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: "00000000-0000-4000-8000-000000000099",
    }] } },
  });
  const rendered = renderExplainRun(buildExplainRunView({ run, checkpoints: [], writes: [], nodeIds: [], dependencies: [], failure }));
  assert.match(rendered, /sign-in check verify-landing: the check saw https:\/\/example\.test\/people\/\[removed\]/);
  assert.match(rendered, /page https:\/\/example\.test\/people\/\[removed\]/);
  assert.equal(rendered.includes("10456712"), false);
  assert.equal(rendered.toLowerCase().includes(encoded.toLowerCase()), false);
});

it("explains a protected run without a percent-encoded credential or uppercase URL", () => {
  const encoded = percentEncode("password=SECRET_CANARY HTTPS://user:USERINFO_CANARY@example.test/read?token=QUERY_CANARY#FRAGMENT_CANARY");
  const login = new BrowserLoginError("ucpath", "verify-landing", `the check saw ${encoded}`, "https://example.test/login");
  const taskId = TaskIdSchema.parse("ucpath/search-person-org");
  const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", nodeId: NodeIdSchema.parse("searching"), taskId,
    error: new TaskError(taskId, login.code, login.message, { cause: login }), occurredAt: QUEUED_RUN.createdAt });
  const run = protectedExplainRun();
  const rendered = renderExplainRun(buildExplainRunView({ run, checkpoints: [], writes: [], nodeIds: [], dependencies: [], failure }));
  assert.match(rendered, /sign-in check verify-landing: the check saw password=\[removed\] https:\/\/example\.test\/read/);
  assert.match(rendered, /page https:\/\/example\.test\/login/);
  for (const canary of ["SECRET_CANARY", "USERINFO_CANARY", "QUERY_CANARY", "FRAGMENT_CANARY"]) {
    assert.equal(rendered.includes(canary), false, canary);
  }
});

it("explains a protected run without a query hidden in the page path or an undecodable employee-id run", () => {
  const encoded = percentEncode("10456712");
  const login = new BrowserLoginError("ucpath", "verify-landing",
    `the check saw https://example.test/people/%FF${encoded}`,
    "https://example.test/read%3Ftoken%3DQUERY_CANARY%23FRAGMENT_CANARY");
  const taskId = TaskIdSchema.parse("ucpath/search-person-org");
  const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", nodeId: NodeIdSchema.parse("searching"), taskId,
    error: new TaskError(taskId, login.code, login.message, { cause: login }), occurredAt: QUEUED_RUN.createdAt });
  const rendered = renderExplainRun(buildExplainRunView({
    run: protectedExplainRun(), checkpoints: [], writes: [], nodeIds: [], dependencies: [], failure,
  }));
  assert.match(rendered, /sign-in check verify-landing: the check saw https:\/\/example\.test\/people\/\[invalid-encoding\]/);
  assert.match(rendered, /page https:\/\/example\.test\/read/);
  assert.equal(rendered.includes("10456712"), false);
  assert.equal(rendered.toLowerCase().includes(encoded.toLowerCase()), false);
  assert.equal(rendered.includes("QUERY_CANARY"), false);
  assert.equal(rendered.includes("FRAGMENT_CANARY"), false);
});

function percentEncode(text: string): string {
  return [...text].map(character => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");
}

function protectedExplainRun() {
  return RunRecordSchema.parse({
    ...QUEUED_RUN,
    input: { ...QUEUED_RUN.input, parsed: { ...QUEUED_RUN.input.parsed, protectedBindings: [{
      kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: "00000000-0000-4000-8000-000000000099",
    }] } },
  });
}
