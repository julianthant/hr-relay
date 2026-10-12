import { z } from "zod";
import { ContractFieldPathSchema, defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { EidSchema, ObservationIdSchema, TaskIdSchema, taskId, type ScenarioId } from "../../../../src/rules/identity/ids.js";

export function createFlowTaskFixtures(SCENARIO: ScenarioId) {
  const INPUT = z.strictObject({ eid: EidSchema });

  const readOne = defineTaskContract({
    id: taskId("ucpath/search-person-org"),
    title: "Search Person Org",
    effect: "read",
    input: INPUT,
    output: z.strictObject({ eid: EidSchema }),
    errorCodes: ["eid-not-found"] as const,
    subject: {
      kind: "person",
      expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" },
      observe: ObservationIdSchema.parse("ucpath.person-org.displayed-eid"),
      match: "normalized-exact-eid",
      requiredAt: "before-subject-read",
    },
    scenarios: [SCENARIO],
    freshness: { defaultMaxAgeMs: 0 },
    provenance: { default: "live" },
    example: { eid: "10800000" },
  });

  const readTwo = defineTaskContract({
    id: taskId("crm/read-contact"),
    title: "Read CRM contact",
    effect: "read",
    input: INPUT,
    output: z.strictObject({ eid: EidSchema }),
    errorCodes: ["contact-missing"] as const,
    subject: { kind: "none", reason: "keyed by EID" },
    scenarios: [SCENARIO],
    freshness: { defaultMaxAgeMs: 0 },
    provenance: { default: "live" },
    example: { eid: "10800000" },
  });

  const preparePair = defineTaskContract({
    id: taskId("ucpath/fill-termination"),
    title: "Fill termination",
    effect: "prepare",
    input: INPUT,
    output: z.strictObject({ stagedRows: z.number().int() }),
    errorCodes: ["fill-failed"] as const,
    subject: { kind: "none", reason: "prepare fixture" },
    scenarios: [SCENARIO],
    checkpoint: "in-memory-only",
    example: { stagedRows: 1 },
  });

  const PROOF = z.strictObject({ transactionId: z.string() });
  const commitPair = defineTaskContract({
    id: taskId("ucpath/submit-termination"),
    title: "Submit termination",
    effect: "commit",
    input: INPUT,
    output: PROOF,
    errorCodes: ["submit-failed"] as const,
    subject: {
      kind: "person",
      expected: { fromInput: ContractFieldPathSchema.parse("eid"), identity: "eid" },
      observe: ObservationIdSchema.parse("ucpath.person-org.displayed-eid"),
      match: "normalized-exact-eid",
      requiredAt: "after-prepare-before-fence",
    },
    scenarios: [SCENARIO],
    writeSafety: {
      completion: {
        kind: "receipt" as const,
        proofSchema: PROOF,
        proofFromOutput: (output: z.output<typeof PROOF>) => output,
        proofFromPresentProbe: ({ proof }: { proof: z.output<typeof PROOF> }) => proof,
        outputFromProof: (proof: z.output<typeof PROOF>) => proof,
      },
      idempotency: {
        probe: { taskId: TaskIdSchema.parse("ucpath/search-person-org"), effect: "read" as const },
        key: ({ eid }: { eid: string }) => `${eid}|termination`,
        recoveryAbsence: {
          kind: "stabilized" as const,
          minSinceFenceMs: 1_000,
          consistentReads: 2 as const,
          minBetweenReadsMs: 500,
          requireSameSourceState: true as const,
        },
      },
    },
    example: { transactionId: "T1" },
  });
  return { INPUT, readOne, readTwo, preparePair, PROOF, commitPair };
}
