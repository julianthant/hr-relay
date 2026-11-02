import { OnbaseInputSchema, ONBASE_EXAMPLE_INPUT } from "../../models/systems/onbase/import-document.js";
import { defineCanonicalInput } from "../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { onbaseSourcePageDefinition } from "./steps/source-page/step.js";
import { onbaseImportDocumentDefinition } from "./steps/import-document/step.js";

export const OnbaseCanonicalInput = defineCanonicalInput(OnbaseInputSchema, OnbaseInputSchema, [ONBASE_EXAMPLE_INPUT]);
export const onbaseWorkflow = defineWorkflow({
  id: "onbase", version: 1, code: "ob", label: "OnBase Emergency Contact", icon: "FileStack", category: "documents",
  summary: "Imports one person's selected Emergency Contact PDF page into OnBase after exact employee lookup and saved-document verification.",
  input: OnbaseInputSchema, canonicalInput: OnbaseCanonicalInput, inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, role: defineWorkflowRole({ kind: "composition" }),
  identity: { matchKey: input => `onbase:${sha256Hex(JSON.stringify([input.ucpathId, input.document.sha256, input.sourcePage]))}` },
  presentation: { title: input => input.ucpathId, subtitle: input => `Emergency Contact · page ${input.sourcePage}` },
  details: [{ key: "document-id", label: "OnBase document", source: { kind: "result", fieldPath: "savedDocument.documentId" }, display: "text" }],
  scenarios: ["onbase/one-page", "onbase/prepare", "onbase/keyset-miss", "onbase/identity-mismatch", "onbase/committed", "onbase/unknown", "onbase/dry-run"],
  nodePurposes: [
    { nodeId: "source-page", purpose: "Read and verify the content-addressed PDF, extract exactly the selected page and bind its bytes to this session." },
    { nodeId: "import-document", purpose: "Probe for the exact saved PDF, stage and verify all required employee keywords, import once through the write sequencer and prove the saved document by retrieval." },
  ],
  steps: author => {
    const source = onbaseSourcePageDefinition.build(author), imported = onbaseImportDocumentDefinition.build(author, source);
    return { steps: [...source.steps, ...imported.steps], result: imported.result };
  },
});
