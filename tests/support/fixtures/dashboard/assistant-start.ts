import { AssistantActionProposalSchema } from "../../../../src/models/dashboard/assistant.js";

export const ASSISTANT_START_PROPOSAL = AssistantActionProposalSchema.parse({
  chatId: "00000000-0000-4000-8000-000000000001",
  actionId: "00000000-0000-4000-8000-000000000002",
  revision: 1, expiresAt: "2099-01-01T00:00:00Z",
  label: "Start Person Lookup", targetLabel: "1 person",
  effect: "workflow-start", source: "run", workflowId: "person-lookup", dryRun: false,
  startPlan: {
    startPlanId: "00000000-0000-4000-8000-000000000003",
    workflowId: "person-lookup", expectedVersion: 2, expiresAt: "2099-01-01T00:00:00Z",
    dryRun: false, browserMode: "headed", captureBrowserScreenshots: true,
    fingerprints: { descriptorFingerprint: "a".repeat(64), configFingerprint: "b".repeat(64),
      ingressSchemaHash: "c".repeat(64), canonicalInputSchemaHash: "d".repeat(64), inputFingerprint: "e".repeat(64) },
    planned: [{ title: "EID 10101010", subtitle: "Person Lookup", display: { kind: "person", name: "Sample, Avery", employeeId: "10101010" } }],
  },
});

const start = ASSISTANT_START_PROPOSAL.effect === "workflow-start" ? ASSISTANT_START_PROPOSAL : undefined!;
const person = (name: string, employeeId: string) => ({ title: `EID ${employeeId}`, subtitle: "Person Lookup", display: { kind: "person", name, employeeId } });

export const ASSISTANT_START_MULTI_PROPOSAL = AssistantActionProposalSchema.parse({ ...start, source: "entries", targetLabel: "3 people",
  startPlan: { ...start.startPlan, planned: [person("Sample, Avery", "10101010"), person("Vega, Morgan", "20202020"), person("Rivera, Alex", "30303030")] } });

export const ASSISTANT_RERUN_PROPOSAL = AssistantActionProposalSchema.parse({ ...start, source: "rerun", label: "Rerun Person Lookup" });

export const ASSISTANT_SEPARATIONS_MULTI_PROPOSAL = AssistantActionProposalSchema.parse({ ...start, source: "entries", workflowId: "separations",
  label: "Start Separations", targetLabel: "2 documents", startPlan: { ...start.startPlan, workflowId: "separations", planned: [
    { title: "Document 4501", subtitle: "Separations", display: { kind: "document", documentNumber: "4501" } },
    { title: "Document 4502", subtitle: "Separations", display: { kind: "document", documentNumber: "4502" } }] } });

export const ASSISTANT_PAUSE_PROPOSAL = AssistantActionProposalSchema.parse({ chatId: start.chatId, actionId: start.actionId, revision: 1,
  expiresAt: "2099-01-01T00:00:00Z", label: "Pause Person Lookup", targetLabel: "EID 10101010", effect: "run-action", action: "pause",
  workflowId: "person-lookup", run: { runId: "00000000-0000-4000-8000-000000000004", expectedVersion: 3 },
  row: person("Sample, Avery", "10101010") });
