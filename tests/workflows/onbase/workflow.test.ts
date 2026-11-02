import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CHILD_ONLY_WORKFLOW_MODULES, onbaseModule, workflowModuleOf, childWorkflowModuleOf, WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { onbaseSourcePageModule, onbaseImportDocumentModule, STEP_PROOF_MODULES } from "../../../src/backend/app/registries/step-proof-modules.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { BROWSER_SYSTEM_BINDINGS } from "../../../src/backend/runtime/browser/system-bindings.js";
import { onbaseStore } from "../../../src/backend/systems/onbase/task-registry.js";
import { OnbaseCommitImport, ONBASE_EXAMPLE_INPUT, OnbaseInputSchema, ONBASE_EXAMPLE_TARGET, ONBASE_EXAMPLE_PROOF, validateOnbaseImportVerdict } from "../../../src/models/systems/onbase/import-document.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";

describe("OnBase child-only workflow registration", () => {
  it("binds its real exclusive system store and derived proofs without public or undeclared starts", () => {
    assert.ok(CHILD_ONLY_WORKFLOW_MODULES.includes(onbaseModule));
    assert.equal(WORKFLOW_MODULES.some(module => module.descriptor.id === "onbase"), false);
    assert.equal(WORKFLOW_DESCRIPTORS.some(descriptor => descriptor.id === "onbase"), false);
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
  it("rejects invalid source pages, non-PDFs, input dry-run flags and mismatched saved proofs", () => {
    for (const input of [{ ...ONBASE_EXAMPLE_INPUT, sourcePage: 0 }, { ...ONBASE_EXAMPLE_INPUT, dryRun: true },
      { ...ONBASE_EXAMPLE_INPUT, document: { ...ONBASE_EXAMPLE_INPUT.document, mediaType: "image/png" } }]) assert.equal(OnbaseInputSchema.safeParse(input).success, false);
    assert.throws(() => validateOnbaseImportVerdict(ONBASE_EXAMPLE_TARGET, { state: "present", proof: { ...ONBASE_EXAMPLE_PROOF, ucpathId: OnbaseInputSchema.shape.ucpathId.parse("10800001") } }));
    assert.throws(() => validateOnbaseImportVerdict(ONBASE_EXAMPLE_TARGET, { state: "present", proof: { ...ONBASE_EXAMPLE_PROOF, pageSha256: ONBASE_EXAMPLE_INPUT.document.sha256 } }));
  });
});
