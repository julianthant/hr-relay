import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { singleAppliedRunId } from "../../../../support/fixtures/operator-command-fixtures.js";

import assert from "node:assert/strict";
import { mkdirSync,readFileSync,rmSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDiagnosticCaptureService } from "../../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../../../../src/backend/storage/sqlite/storage-records.js";
import { RunDetailSectionResponseSchema } from "../../../../../src/models/dashboard/run-detail.js";
import { deriveDiagnosticContentDigest } from "../../../../../src/models/trust/diagnostic-capture.js";
import { DiagnosticBundleSchema,type DiagnosticBundle } from "../../../../../src/models/trust/diagnostic.js";
import { DiagnosticBundleIdSchema } from "../../../../../src/rules/identity/ids.js";
import { fixtureDescriptor } from "../../../../support/fixtures/descriptor-fixtures.js";
import { sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  it.each([
    ["digest", "digest", "X"],
    ["size", "oversized", "PRIVATE_DIAGNOSTIC_BYTES"],
  ] as const)("refuses an indexed artifact whose stored %s is corrupt before Range handling", async (
    _case,
    mutation,
    leakedBytes,
  ) => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const ref = {
      id: attachment.artifactId,
      sha256: attachment.digest,
      bytes: attachment.byteLength,
      mediaType: attachment.mediaType,
    };
    const storedBytes = mutation === "digest" ? "X]" : `[]${leakedBytes}`;
    writeFileSync(join(h.stateRoot, "artifacts", `${ref.sha256}.artifact`), JSON.stringify({
      ref,
      payloadBase64: Buffer.from(storedBytes).toString("base64"),
    }));

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`, {
      headers: { range: "bytes=0-0" },
    });
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.doesNotMatch(bodyText, new RegExp(leakedBytes, "u"));
    assert.equal(response.headers.get("content-range"), null);
    assert.equal(response.headers.get("content-length"), null);
  });

  it("refuses indexed content whose stored media type disagrees with authority", async () => {
    const h = await harness({ profileFixture: profileFixtures.create,
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          findByArtifact: (artifactId) => real.authority.findByArtifact(artifactId).map((row) =>
            DiagnosticAttachmentStorageRecordSchema.parse({
              ...row,
              attachment: {
                kind: "accessibility-excerpt",
                artifactId: row.attachment.artifactId,
                mediaType: "text/yaml",
                byteLength: row.attachment.byteLength,
                digest: row.attachment.digest,
                sensitivity: "redacted",
              },
            })),
        },
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    const body = await json(response);

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.equal(response.headers.get("content-length"), null);
  });

  it("normalizes diagnostic attachment authority failure without leaking its storage path", async () => {
    const localPath = "/private/operator/.tracker/state.sqlite";
    const h = await harness({ profileFixture: profileFixtures.create,
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          findByArtifact: () => {
            throw new Error(`authority unavailable at ${localPath}`);
          },
        },
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.doesNotMatch(bodyText, new RegExp(localPath, "u"));
  });

  it("returns typed missing bytes when authority indexes an artifact whose physical object is missing", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    rmSync(join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`));

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_BYTES_MISSING");
    assert.equal(body.retryable, false);
    assert.match(String(body.message), /has no stored bytes/u);
    assert.doesNotMatch(bodyText, new RegExp(h.stateRoot, "u"));
  });

  it.each(["generic", "bundle"] as const)(
    "reports a local reader filesystem failure on the %s route as path-free internal failure",
    async (profile) => {
      let sabotaged = false;
      const h = await harness({ profileFixture: profileFixtures.create, diagnosticBundles: (real) => ({
        ...real,
        artifactReader: beforeArtifactReaderOperation(real.artifactReader, (_operation, ref) => {
          if (sabotaged) return;
          sabotaged = true;
          const storedPath = join(h.stateRoot, "artifacts", `${ref.sha256}.artifact`);
          rmSync(storedPath);
          mkdirSync(storedPath);
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;

      const response = await h.app.request(path);
      const bodyText = await response.text();
      const body = JSON.parse(bodyText) as Record<string, unknown>;

      assert.equal(response.status, 500);
      assert.equal(body.code, "INTERNAL_FAILURE");
      assert.equal(body.retryable, false);
      assert.match(String(body.message), /verified artifact storage operation failed/u);
      assert.doesNotMatch(bodyText, new RegExp(h.stateRoot, "u"));
      assert.doesNotMatch(bodyText, /DIAGNOSTIC_BUNDLE_(?:CORRUPT|BYTES_MISSING)/u);
      assert.equal(response.headers.get("content-length"), null);
    },
  );

  it("verifies a ranged artifact before refusing partial delivery", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`, {
      headers: { range: "bytes=0-0" },
    });

    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), `bytes */${String(attachment.byteLength)}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });

  it.each([
    ["mutated", false],
    ["missing", true],
  ] as const)("returns a typed path-free failure when a real diagnostic artifact is %s", async (_case, removeArtifact) => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const artifactPath = join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`);
    if (removeArtifact) rmSync(artifactPath);
    else writeFileSync(artifactPath, "{\"mutated\":true}", "utf8");

    const suffix = removeArtifact ? "/manifest" : "";
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}${suffix}`);
    const body = await json(response);
    assert.equal(response.status, 500);
    assert.equal(body.code, removeArtifact ? "DIAGNOSTIC_BUNDLE_BYTES_MISSING" : "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.match(String(body.message), new RegExp(bundle.bundleId, "u"));
    assert.match(String(body.message), new RegExp(attachment.artifactId, "u"));
    assert.match(String(body.message), new RegExp(attachment.kind, "u"));
    assert.doesNotMatch(String(body.message), new RegExp(h.stateRoot, "u"));
    assert.doesNotMatch(String(body.message), /(?:\/private\/|\/var\/folders\/)/u);
  });

  it("returns typed corruption when the diagnostic repository returns a foreign bundle id", async () => {
    const foreignBundleId = DiagnosticBundleIdSchema.parse("00000000-0000-4000-8000-000000000999");
    const h = await harness({ profileFixture: profileFixtures.create,
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          get: (bundleId) => {
            const stored = real.authority.get(bundleId);
            return stored === undefined
              ? undefined
              : { ...stored, bundleId: foreignBundleId };
          },
          listAttachments: real.authority.listAttachments,
          findByArtifact: real.authority.findByArtifact,
        },
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}`);
    const body = await json(response);

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.match(String(body.message), /durable authority identity mismatch/u);
    assert.match(String(body.message), new RegExp(bundle.bundleId, "u"));
    assert.doesNotMatch(String(body.message), new RegExp(foreignBundleId, "u"));
  });

  it("reuses exact-ref verification within one captures request and re-verifies on the next request", async () => {
    const syntheticBundles: DiagnosticBundle[] = [];
    const h = await harness({ profileFixture: profileFixtures.create,
      runCaptureAuthority: (real) => Object.freeze({
        ...real,
        get(bundleId: string) {
          return syntheticBundles.find((bundle) => bundle.bundleId === bundleId) ?? real.get(bundleId);
        },
        listByRun(runId: string) {
          return [...real.listByRun(runId), ...syntheticBundles.filter((bundle) => bundle.runId === runId)];
        },
        listAttachments(bundleId: string) {
          const synthetic = syntheticBundles.find((bundle) => bundle.bundleId === bundleId);
          if (synthetic === undefined) return real.listAttachments(bundleId);
          return synthetic.attachments.map((attachment) => DiagnosticAttachmentStorageRecordSchema.parse({
            bundleId: synthetic.bundleId,
            attachment,
            createdAt: synthetic.createdAt,
          }));
        },
      }),
    });
    const planResponse = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        workflowId: "fixture-graph",
        submissions: [{ eid: "10873698", mode: "read-only" }],
        dryRun: false,
      }),
    });
    assert.equal(planResponse.status, 200);
    const plan = await json(planResponse);
    const fingerprints = plan.fingerprints as Record<string, string>;
    const commandResponse = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7d",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: {
          workflowId: "fixture-graph",
          startPlanId: plan.startPlanId,
          expectedVersion: plan.expectedVersion,
        },
        payload: {
          descriptorFingerprint: fingerprints.descriptorFingerprint,
          configFingerprint: fingerprints.configFingerprint,
          ingressSchemaHash: fingerprints.ingressSchemaHash,
          canonicalInputSchemaHash: fingerprints.canonicalInputSchemaHash,
          inputFingerprint: fingerprints.inputFingerprint,
        },
      }),
    });
    assert.equal(commandResponse.status, 200);
    const plannedRun = { runId: singleAppliedRunId(CommandResultSchema.parse(await json(commandResponse))) };

    const capture = createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("d"),
    });
    const sharedAttachment = {
      kind: "accessibility-excerpt" as const,
      mediaType: "text/yaml",
      bytes: new TextEncoder().encode("- button: Retry"),
      sensitivity: "redacted" as const,
    };
    const first = await capture.capture({
      trigger: "operator-request",
      runId: plannedRun.runId,
      requestedBy: "local-operator",
      configFingerprint: HASH_B,
      descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [],
      attachments: [sharedAttachment],
    });
    const automaticCapture = createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("e"),
    });
    const automaticCases = [
      { trigger: "task-failure", originKind: "failure" },
      { trigger: "unexpected-state", originKind: "unexpected-state" },
      { trigger: "subject-mismatch", originKind: "subject-mismatch" },
      { trigger: "recovery-park", originKind: "recovery-park" },
    ] as const;
    const automaticBundles: DiagnosticBundle[] = [];
    for (const automaticCase of automaticCases) {
      const prepared = await automaticCapture.prepare({
        trigger: automaticCase.trigger,
        runId: plannedRun.runId,
        failureId: "00000000-0000-4000-8000-0000000000f1",
        configFingerprint: HASH_B,
        descriptorFingerprint: fixtureDescriptor.contractFingerprint,
        fields: [],
        attachments: [sharedAttachment],
      });
      automaticCapture.discard(prepared);
      const attachments = first.attachments;
      automaticBundles.push(DiagnosticBundleSchema.parse({ ...prepared, attachments,
        contentDigest: deriveDiagnosticContentDigest({ runId: prepared.runId, origin: prepared.origin,
          capturedAt: prepared.createdAt, configFingerprint: prepared.configFingerprint,
          descriptorFingerprint: prepared.descriptorFingerprint, redaction: prepared.redaction, attachments }) }));
    }
    syntheticBundles.push(...automaticBundles);
    const firstAttachment = first.attachments[0];
    if (firstAttachment === undefined || automaticBundles.some((bundle) => bundle.attachments[0] === undefined)) {
      throw new Error("the diagnostic fixtures did not write their shared attachment");
    }
    for (const automatic of automaticBundles) {
      assert.notEqual(first.bundleId, automatic.bundleId);
      assert.notDeepEqual(first.origin, automatic.origin);
      assert.notEqual(first.contentDigest, automatic.contentDigest);
      assert.deepEqual(automatic.attachments[0], firstAttachment);
    }
    const envelopeByteLength = readFileSync(
      join(h.stateRoot, "artifacts", `${firstAttachment.digest}.artifact`),
    ).byteLength;

    const readCaptures = async () => {
      const response = await h.app.request(`/api/v1/runs/${plannedRun.runId}/captures`);
      assert.equal(response.status, 200);
      const captures = RunDetailSectionResponseSchema.parse(await response.json());
      assert.equal(captures.section, "captures");
      if (captures.section !== "captures") throw new Error("expected captures");
      return captures;
    };
    const firstResponse = await readCaptures();
    const firstRequestSourceReads = [...h.artifactSourceReads];
    const secondResponse = await readCaptures();
    const secondRequestSourceReads = [...h.artifactSourceReads];
    const expectedArtifacts = [{
      artifact: {
        mediaKind: "data",
        artifactId: firstAttachment.artifactId,
        mediaType: firstAttachment.mediaType,
        byteLength: firstAttachment.byteLength,
        sha256: firstAttachment.digest,
        sensitivity: firstAttachment.sensitivity,
        redaction: "applied",
      },
      origins: [
        { bundleId: first.bundleId, originKind: "operator-request" },
        ...automaticBundles.map((bundle, index) => ({
          bundleId: bundle.bundleId,
          originKind: automaticCases[index]?.originKind,
        })),
      ],
    }];
    for (const captures of [firstResponse, secondResponse]) {
      assert.deepEqual(captures.payload.artifacts, expectedArtifacts);
    }
    assert.deepEqual(
      firstRequestSourceReads,
      [envelopeByteLength],
      "one request must completely verify one shared exact artifact ref only once",
    );
    assert.deepEqual(
      secondRequestSourceReads,
      [envelopeByteLength, envelopeByteLength],
      "a second request must perform one additional complete source verification",
    );
  });

  it("serves the timeline for task spans committed through another authority connection", async () => {

    const h = await harness({ profileFixture: profileFixtures.create });
    const plan = await json(await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        workflowId: "fixture-graph",
        submissions: [{ eid: "10873698", mode: "read-only" }],
        dryRun: false,
      }),
    }));
    const fingerprints = plan.fingerprints as Record<string, string>;
    const commandResponse = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7c",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: { workflowId: "fixture-graph", startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion },
        payload: {
          descriptorFingerprint: fingerprints.descriptorFingerprint,
          configFingerprint: fingerprints.configFingerprint,
          ingressSchemaHash: fingerprints.ingressSchemaHash,
          canonicalInputSchemaHash: fingerprints.canonicalInputSchemaHash,
          inputFingerprint: fingerprints.inputFingerprint,
        },
      }),
    });
    const runId = singleAppliedRunId(CommandResultSchema.parse(await json(commandResponse)));
    const created = h.database.authority.runs.get(runId); assert.ok(created);
    const traceId = created.envelope.traceId;

    // Independent worker connection; no in-process projection callback.
    const base = {
      workflow: "fixture-graph", pid: 777, runId, attempt: 1, traceId,
      spanPath: `${traceId}/probe#1`, parentSpanPath: traceId,
    };
    const workerDatabase = AuthorityDatabase.open({ path: join(h.stateRoot, "state.db"),
      busyTimeoutMs: 1000, migrationOwner: "bff-worker-test" }, h.clock);
    try {
      const workerSpans = createTimelineEmitter({ repository: workerDatabase.authority.timelineEvents, clock: h.clock, pid: 777 });
      workerSpans.emit({ ...base, t: "span.started", kind: "task", ts: h.clock.now().toISOString(), name: "probe" });
      workerSpans.emit({ ...base, t: "span.ended", kind: "task", ts: h.clock.now().toISOString(), outcome: "done" });
    } finally { workerDatabase.close(); }

    // Production's poll tick, invoked directly.
    h.projection.ingestFromTimeline();

    const detail = await json(await h.app.request(`/api/v1/runs/${runId}`));
    const timeline = detail.timeline as { events: { label: string; state: string }[] };
    assert.equal(timeline.events.length > 0, true);
    assert.deepEqual(
      timeline.events.filter(({ label }) => label === "probe").map(({ state }) => state),
      ["done"],
    );
  });

  it("refuses an unavailable run-detail section by name and serves failure only when real", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const planResponse = await json(await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid: "10873698", mode: "read-only" }], dryRun: false }),
    }));
    const fingerprints = planResponse.fingerprints as Record<string, string>;
    const commandResponse = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7d",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: {
          workflowId: "fixture-graph",
          startPlanId: planResponse.startPlanId,
          expectedVersion: planResponse.expectedVersion,
        },
        payload: fingerprints,
      }),
    });
    const runId = singleAppliedRunId(CommandResultSchema.parse(await json(commandResponse)));

    const review = await h.app.request(`/api/v1/runs/${runId}/review`);
    assert.equal(review.status, 409);
    assert.equal((await json(review)).code, "SECTION_UNAVAILABLE");


    const receipt = await json(await h.app.request(`/api/v1/runs/${runId}/receipt`));
    assert.deepEqual(receipt.payload, {
      state: "missing",
      reason: "run is queued; a receipt states a settled verdict and this run has none yet",
    });

    const failure = await json(await h.app.request(`/api/v1/runs/${runId}/failure`));
    assert.equal((failure.payload as { state: string }).state, "missing");

    const attempts = await json(await h.app.request(`/api/v1/runs/${runId}/context-attempts`));
    const entries = (attempts.payload as { entries: { label: string; valueRedacted: string }[] }).entries;
    assert.deepEqual(entries[0], { label: "current-attempt", valueRedacted: "1" });
  });


});

import { HASH_B,OPERATOR_JSON_HEADERS,beforeArtifactReaderOperation,captureDiagnosticBundle,disposeHttpRouteHarness,harness,json } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
