import { AssistantActionProposalSchema } from "../../../../src/models/dashboard/assistant.js";

export const ASSISTANT_START_PROPOSAL = AssistantActionProposalSchema.parse({
  chatId: "00000000-0000-4000-8000-000000000001",
  actionId: "00000000-0000-4000-8000-000000000002",
  revision: 1, expiresAt: "2099-01-01T00:00:00Z",
  label: "Start Person Lookup", targetLabel: "EID 10101010",
  subject: "selected-run", effect: "workflow-start", workflowId: "person-lookup", dryRun: false,
  startPlan: {
    startPlanId: "00000000-0000-4000-8000-000000000003",
    workflowId: "person-lookup", expectedVersion: 2, expiresAt: "2099-01-01T00:00:00Z",
    dryRun: false, browserMode: "headed", captureBrowserScreenshots: true,
    fingerprints: { descriptorFingerprint: "a".repeat(64), configFingerprint: "b".repeat(64),
      ingressSchemaHash: "c".repeat(64), canonicalInputSchemaHash: "d".repeat(64), inputFingerprint: "e".repeat(64) },
    planned: [{ title: "EID 10101010", subtitle: "Person Lookup" }],
  },
});
