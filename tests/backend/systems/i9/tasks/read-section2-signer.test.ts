import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createI9Driver } from "../../../../../src/backend/systems/i9/driver/interpreter.js";
import { createDeterministicI9Driver } from "../../../../support/fixtures/backend/i9-driver-fake.js";
import { readSection2SignerTask } from "../../../../../src/backend/systems/i9/tasks/read-section2-signer.js";
import { createTaskProvenanceCollector } from "../../../../../src/backend/runs/provenance/task-provenance.js";
import { redactObservedDataPoints } from "../../../../../src/backend/logs/observed-data.js";
import { I9ReadSection2Signer, type I9SignerOutput } from "../../../../../src/models/systems/i9/read-section2-signer.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { compileWorkflow } from "../../../../../src/workflow-kit/workflow-definition.js";
import { i9LookupWorkflow } from "../../../../../src/workflows/i9-lookup/workflow.js";
import { fakeI9Page, i9SearchRow } from "../../../../support/helpers/browser/fake-i9-page.js";

const log = { debug: () => undefined, info: () => undefined, warn: () => undefined };
const input = { lastName: "Example", firstName: "Person" };
const descriptor = compileWorkflow(i9LookupWorkflow).descriptor;

describe("I-9 signer task", () => {
  it("records every output leaf through the executor provenance collector for every status", async () => {
    const record = { profileId: "900001", i9Id: "900002" };
    const lookups: readonly I9SignerOutput[] = [
      { i9Status: "signed", signerName: "Example Representative", ...record },
      { i9Status: "unsigned", signerName: "", ...record },
      { i9Status: "unsigned", signerName: "" },
      { i9Status: "not-found", signerName: "" },
      { i9Status: "unable-to-access", signerName: "" },
      { i9Status: "historical", signerName: "", ...record },
    ];
    for (const lookup of lookups) {
      const collector = createTaskProvenanceCollector({
        descriptor, execution: { runId: "aaaaaaaa-0001-4000-8000-000100000000", traceId: "il-190000-aaaa", attempt: 1, workflowId: descriptor.id, nodeId: "lookup-source", taskId: I9ReadSection2Signer.id },
        upstreamEvidence: { checkpoints: [] }, clock: manualClock(new Date("2026-11-01T12:00:00Z")),
        onRecord: batch => { redactObservedDataPoints(I9ReadSection2Signer.id, batch.points); },
      });
      let screenshots = 0;
      const output = await readSection2SignerTask.impl.run({ input, ctx: {
        driver: createDeterministicI9Driver({ lookup, now: "2026-11-01T12:00:00.000Z" }), signal: new AbortController().signal, log,
        fail: (_code, message): never => { throw new Error(message); }, recordData: collector.recordData,
        captureScreenshot: async () => { screenshots++; },
      } });
      const proof = collector.finalizeRead(output);
      assert.deepEqual(proof.provenance.map(fact => fact.path).sort(), Object.keys(output).sort());
      assert.equal(screenshots, 1);
    }
  });

  it("emits named failures instead of unsigned or not-found on broken and ambiguous reads", async () => {
    for (const [options, code] of [
      [{ missingAudit: true }, "I9_LOOKUP_FAILED"],
      [{ signedRows: 0 }, "I9_LOOKUP_FAILED"],
      [{ signedRows: 1 }, "I9_LOOKUP_FAILED"],
      [{ signedRows: 2 }, "I9_LOOKUP_AMBIGUOUS"],
      [{ rows: [i9SearchRow(), i9SearchRow({ profileId: "900003" })] }, "I9_LOOKUP_AMBIGUOUS"],
    ] as const) {
      const { page } = fakeI9Page(options);
      const points: unknown[] = [];
      await assert.rejects(readSection2SignerTask.impl.run({ input, ctx: {
        driver: createI9Driver(() => undefined, page), signal: new AbortController().signal, log,
        fail: failureCode => { throw new Error(failureCode); }, recordData: point => { points.push(point); }, captureScreenshot: async () => undefined,
      } }), new RegExp(code));
      assert.deepEqual(points, []);
    }
  });
});
