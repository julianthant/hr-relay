import { onbaseImportDocumentModule, onbaseModule, onbaseSourcePageModule } from "../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DESCRIPTORS, CHILD_ONLY_WORKFLOW_MODULES, workflowModuleOf, childWorkflowModuleOf, WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { STEP_PROOF_MODULES } from "../../../src/backend/app/registries/step-proof-modules.js";
import { BROWSER_SYSTEM_BINDINGS } from "../../../src/backend/runtime/browser/system-bindings.js";
import { onbaseStore } from "../../../src/backend/systems/onbase/task-registry.js";
import { ONBASE_EXAMPLE_INPUT, OnbaseInputSchema, ONBASE_EXAMPLE_TARGET, ONBASE_EXAMPLE_PROOF, validateOnbaseImportVerdict } from "../../../src/models/systems/onbase/import-document.js";
import { OnbaseCommitImport } from "../../../src/models/systems/onbase/upload-import.js";
import { planStepOmissions } from "../../../src/models/workflow/step-omission.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { OnbaseResultSchema } from "../../../src/workflows/onbase/steps/import-document/step.js";

describe("OnBase child-only workflow registration", () => {
  it("binds its real exclusive system store and derived proofs without public or undeclared starts", () => {
    assert.ok(CHILD_ONLY_WORKFLOW_MODULES.includes(onbaseModule));
    assert.equal(WORKFLOW_MODULES.some(module => module.descriptor.id === "onbase"), false);
    assert.equal(DESCRIPTORS.some(descriptor => descriptor.id === "onbase"), false);
    assert.throws(() => workflowModuleOf("onbase"), /not registered/u);
    assert.throws(() => childWorkflowModuleOf("person-lookup", "onbase"), /does not declare delegation/u);
    assert.deepEqual(onbaseModule.descriptor.surfaces, {});
    assert.ok(onbaseModule.stores.includes(onbaseStore));
    assert.equal(onbaseStore.session.exclusive, true); assert.equal(BROWSER_SYSTEM_BINDINGS.onbase?.exclusive, true);
    assert.equal(onbaseStore.tasks.commitImport.contract, OnbaseCommitImport);
    assert.deepEqual(onbaseModule.descriptor.timeline.map(step => step.key), ["source-page", "import-document"]);
    for (const proof of [onbaseSourcePageModule, onbaseImportDocumentModule]) {
      assert.ok(STEP_PROOF_MODULES.includes(proof)); assert.equal(proof.role.kind, "chunk-harness"); assert.deepEqual(proof.descriptor.surfaces, {});
    }
  });
  it("keeps dry-run stop-after-prepare, mandatory probes and operator-only negative recovery", () => {
    const imported = descriptorRuntimeNodes(onbaseModule.descriptor).find(node => node.kind === "transaction"); assert.ok(imported); assert.equal(imported.kind, "transaction");
    if (imported.kind !== "transaction") throw new Error("missing import transaction");
    assert.equal(imported.dryRun, "stop-after-prepare"); assert.equal(imported.probePolicy, "always");
    assert.equal(OnbaseCommitImport.writeSafety.completion.kind, "upload-verify");
    assert.equal(OnbaseCommitImport.writeSafety.idempotency.recoveryAbsence.kind, "operator-only");
  });
  it("pins the executable graphs and OnBase-only omission plans", () => {
    const { descriptor } = onbaseModule;
    const nodes = descriptorRuntimeNodes(descriptor);
    const sourceGraph = [["source-page", "task", []]];
    const importGraph = [...sourceGraph, ["import-document", "transaction", ["source-page"]]];
    const graph = (workflow: AnyWorkflowDescriptor) => descriptorRuntimeNodes(workflow).map(({ id, kind, dependsOn }) => [id, kind, dependsOn]);
    assert.deepEqual(graph(descriptor), importGraph);
    assert.deepEqual(graph(onbaseSourcePageModule.descriptor), sourceGraph);
    assert.deepEqual(graph(onbaseImportDocumentModule.descriptor), importGraph);
    assert.deepEqual(descriptor.stepLocks, []);

    const view = { nodes, timeline: descriptor.timeline, stepOmissions: descriptor.stepOmissions };
    const allOn = planStepOmissions(view, []);
    assert.deepEqual([...allOn.asserted, ...allOn.omitted, ...allOn.manual, ...allOn.refusals], []);
    const allOff = planStepOmissions(view, [{ step: "source-page", facts: { sourcePage: 1 } }, { step: "import-document", facts: {} }]);
    assert.deepEqual([...allOff.omitted], [["source-page", "source-page"]]);
    assert.deepEqual([...allOff.manual], [["import-document", "import-document"]]);
    assert.deepEqual([...allOff.asserted, ...allOff.refusals], []);
  });
  it("requires saved-document proof for a filing and refuses it for a manual import", () => {
    assert.equal(OnbaseResultSchema.safeParse({ disposition: "committed", savedDocument: ONBASE_EXAMPLE_PROOF }).success, true);
    assert.equal(OnbaseResultSchema.safeParse({ disposition: "committed" }).success, false);
    assert.equal(OnbaseResultSchema.safeParse({ disposition: "omitted" }).success, true);
    assert.equal(OnbaseResultSchema.safeParse({ disposition: "omitted", savedDocument: ONBASE_EXAMPLE_PROOF }).success, false);
  });
  it("rejects invalid source pages, non-PDFs, input dry-run flags and mismatched saved proofs", () => {
    for (const input of [{ ...ONBASE_EXAMPLE_INPUT, sourcePage: 0 }, { ...ONBASE_EXAMPLE_INPUT, dryRun: true },
      { ...ONBASE_EXAMPLE_INPUT, document: { ...ONBASE_EXAMPLE_INPUT.document, mediaType: "image/png" } }]) assert.equal(OnbaseInputSchema.safeParse(input).success, false);
    assert.throws(() => validateOnbaseImportVerdict(ONBASE_EXAMPLE_TARGET, { state: "present", proof: { ...ONBASE_EXAMPLE_PROOF, ucpathId: OnbaseInputSchema.shape.ucpathId.parse("10800001") } }));
    assert.throws(() => validateOnbaseImportVerdict(ONBASE_EXAMPLE_TARGET, { state: "present", proof: { ...ONBASE_EXAMPLE_PROOF, pageSha256: ONBASE_EXAMPLE_INPUT.document.sha256 } }));
  });
});
