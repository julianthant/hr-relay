import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { ReadWorkbookResult } from "../../src/models/processing/workbooks/read-result.js";
import { defineCanonicalInput } from "../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/models/workflow/presentation.js";
import { EidSchema } from "../../src/rules/identity/ids.js";
import { flow } from "../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, defineWorkflowStep, workflowDryRunSupport } from "../../src/workflow-kit/workflow.js";
import { namedFileOutputContract } from "../support/fixtures/named-file-output-workflow.js";
import { WRITE_FIXTURE_EID, WriteFixtureCommit, WriteFixturePrepare } from "../support/fixtures/write-sequencer-fixtures.js";

const Input = z.strictObject({ eid: EidSchema });
const stopBeforePublish = { dryRun: "stop-before-publish" } as const;
const command = () => ({ name: "Results", table: { name: "Results", columns: ["a"], rows: [{ id: "1", values: ["v"] }] } });
const base = () => flow(Input);
const save = (graph: ReturnType<typeof base>, opts: object = stopBeforePublish) => graph.step("save", ReadWorkbookResult,
  { dependsOn: [], replay: "checkpoint", ...opts, bind: command });
const write = (graph: ReturnType<typeof base>, dryRun: "stop-after-prepare" | "unsupported"): ReturnType<typeof base> => graph.transaction("write", {
  dependsOn: [], prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
  commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) }, dryRun, probePolicy: "always", probeToFenceMaxMs: 30_000 }) as never;
const define = (built: unknown, extra: object = {}) => defineWorkflowDescriptor({
  id: "preview-boundary-fixture", version: 1, contractFingerprint: "a".repeat(64), code: "pb", label: "Preview boundary fixture", icon: "Search", category: "operations",
  canonicalInput: defineCanonicalInput(Input, Input, [{ eid: WRITE_FIXTURE_EID }]), inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], identity: { matchKey: (value: z.output<typeof Input>) => `eid:${value.eid}` },
  presentation: { title: (value: z.output<typeof Input>) => value.eid }, scenarios: ["preview-boundary-fixture/happy"], ...extra, flow: built,
} as never);
const result = z.strictObject({ ok: z.boolean() });
const finish = (graph: { build: (spec: never) => unknown }, dependsOn: string[]) => graph.build({ schema: result, dependsOn, derive: () => ({ ok: true }) } as never);

describe("workflow flow builder", () => {
  describe("workflow steps", () => {
    it("refuses a step whose folder key is not a kebab-case slug", () => {
      assert.throws(
        () => defineWorkflowStep({ key: "Not Kebab", label: "Invalid folder" }),
        /timeline category key must be a kebab-case slug/,
      );
    });
  });

  describe("publication preview boundary", () => {
    it("derives a publication boundary from a task declaring stop-before-publish", () => {
      const descriptor = define(finish(save(base()), ["save"]));
      assert.deepEqual(workflowDryRunSupport(descriptor), { state: "supported", firstPublicationNodeId: "save" });
    });

    it("keeps the transaction boundary when a transaction precedes the publication task", () => {
      const descriptor = define(finish(save(write(base(), "stop-after-prepare")), ["write", "save"]));
      assert.deepEqual(workflowDryRunSupport(descriptor), { state: "supported", firstTransactionNodeId: "write" });
    });

    it("still refuses a transaction that declares no preview arm", () => {
      const descriptor = define(finish(save(write(base(), "unsupported")), ["write", "save"]));
      assert.deepEqual(workflowDryRunSupport(descriptor), { state: "unsupported", reason: "node-declares-unsupported", nodeId: "write" });
    });

    it("refuses stop-before-publish on a task whose contract declares no provider", () => {
      const graph = base().step("archive", namedFileOutputContract,
        { dependsOn: [], replay: "checkpoint", ...stopBeforePublish, bind: () => ({ name: "x" }) });
      assert.throws(() => define(finish(graph, ["archive"])), /provider/u);
    });

    it("refuses an artifact projection whose source does not depend on a boundary", () => {
      const projection = { id: "batch-archive", source: { nodeId: "archive", fieldPath: "archive" }, keyFields: ["archive.artifact.sha256"], sink: "documents-file", blocking: true } as const;
      const archive = (dependsOn: readonly "save"[]) => save(base()).step("archive", namedFileOutputContract, { dependsOn, replay: "checkpoint", bind: () => ({ name: "x" }) });
      assert.doesNotThrow(() => define(finish(archive(["save"]), ["archive"]), { artifactProjections: [projection] }));
      assert.throws(() => define(finish(archive([]), ["archive"]), { artifactProjections: [projection] }), /boundary/u);
    });

    it("refuses a projection behind a boundary a false condition can skip, and accepts one behind an unconditional transaction", () => {
      const projection = { id: "batch-archive", source: { nodeId: "archive", fieldPath: "archive" }, keyFields: ["archive.artifact.sha256"], sink: "documents-file", blocking: true } as const;
      const when = { kind: "equals", of: { from: "input", path: "eid" }, value: WRITE_FIXTURE_EID } as const;
      const conditional = save(base(), { ...stopBeforePublish, when }).step("archive", namedFileOutputContract, { dependsOn: ["save"], replay: "checkpoint", bind: () => ({ name: "x" }) });
      assert.throws(() => define(finish(conditional, ["archive"]), { artifactProjections: [projection] }), /unconditional dry-run preview boundary/u);
      const mixed = save(write(base(), "stop-after-prepare")).step("archive", namedFileOutputContract, { dependsOn: ["write"] as never, replay: "checkpoint", bind: () => ({ name: "x" }) });
      assert.doesNotThrow(() => define(finish(mixed, ["save", "archive"]), { artifactProjections: [projection] }));
    });
  });
});
