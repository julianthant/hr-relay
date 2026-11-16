import { z } from "zod";
import { ArtifactRefSchema,NamedArtifactOutputSchema } from "../../../src/models/artifacts/artifacts.js";
import { defineTaskContract } from "../../../src/models/task/task-contract.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { ScenarioIdSchema,taskId } from "../../../src/rules/identity/ids.js";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";

export const namedFileOutputScenario = ScenarioIdSchema.parse("wiring-projection/archive");
const input = z.strictObject({ name: z.string() });
const canonicalInput = defineCanonicalInput(input, input, [{ name: "Synthetic batch" }]);
export const namedFileOutputContract = defineTaskContract({ id: taskId("workflow:wiring-projection/read-archive"), title: "Publish archive", effect: "read", input,
  output: z.strictObject({ archive: NamedArtifactOutputSchema }), errorCodes: ["archive-unavailable"] as const, artifacts: "content-addressed",
  subject: { kind: "none", reason: "synthetic batch archive" }, scenarios: [namedFileOutputScenario], freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "live" }, example: { archive: { fileName: "Synthetic archive.zip", artifact: ArtifactRefSchema.parse({ id: "aaaaaaaa-1111-4111-8111-111111111111", sha256: "a".repeat(64), bytes: 1, mediaType: "application/zip" }) } } });
const definition = flow(input).step("archive", namedFileOutputContract, { dependsOn: [], replay: "checkpoint", bind: ({ input: value }) => ({ name: value.name }) })
  .build({ schema: z.strictObject({ done: z.boolean() }), dependsOn: ["archive"], derive: () => ({ done: true }) });
export const namedFileOutputDescriptor = defineWorkflowDescriptor({ id: "wiring-projection", version: 1, contractFingerprint: "a".repeat(64), code: "wj", label: "Named output fixture", icon: "Search", category: "operations",
  canonicalInput, inputSubject: "name", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
  identity: { matchKey: (value: z.output<typeof input>) => value.name }, presentation: { title: (value: z.output<typeof input>) => value.name }, scenarios: [String(namedFileOutputScenario)],
  artifactProjections: [{ id: "batch-archive", source: { nodeId: "archive", fieldPath: "archive" }, keyFields: ["archive.artifact.sha256"], sink: "documents-file", blocking: true }], flow: definition });
