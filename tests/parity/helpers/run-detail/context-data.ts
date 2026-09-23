import { deriveSchemaHash } from "../../../../src/domain/schema-bound-value.js";
import { ContractFieldPathSchema } from "../../../../src/domain/contracts/base.js";
import { NodeIdSchema } from "../../../../src/domain/ids.js";
import { personLookupDescriptor } from "../../../helpers/registered-workflows.js";
import { at, CONTRACT_FINGERPRINT, uuidOf } from "../fixture-identity.js";
import { FIXTURE_IDS } from "../fixture-queue.js";
import { sectionResponse } from "./section-wire.js";

type DataEntrySeed = Readonly<{
  label: string;
  valueRedacted: string;
  fieldPath: string;
  observedAt?: string;
  source?: "live" | "derived" | "operator";
  correctedAt?: string;
  origin?: Readonly<{ step: string; dir: "read" | "write"; system?: string }>;
}>;

const dateNode = personLookupDescriptor.nodes.find((node) => node.id === "crm-dates");
if (dateNode === undefined || dateNode.kind !== "task" || !("uses" in dateNode)) {
  throw new Error("the Context Data fixture requires the registered CRM dates output schema");
}
const DATE_OUTPUT_SCHEMA_HASH = deriveSchemaHash(dateNode.uses.output, "output");

function sectionsOf(seed: number, entries: readonly DataEntrySeed[]) {
  const runId = uuidOf(seed);
  return Object.freeze({
    "context-data": sectionResponse({
      section: "context-data",
      payload: {
        runId,
        state: "available",
        entries: entries.map((entry) => ({
          label: entry.label,
          valueRedacted: entry.valueRedacted,
          coordinate: {
            nodeId: NodeIdSchema.parse("crm-dates"),
            fieldPath: ContractFieldPathSchema.parse(entry.fieldPath),
          },
          checkpoint: {
            state: "present",
            runId,
            attempt: 1,
            claimGeneration: 1,
            descriptorVersion: personLookupDescriptor.version,
            contractFingerprint: CONTRACT_FINGERPRINT,
            schemaHash: DATE_OUTPUT_SCHEMA_HASH,
            writtenAt: at(52),
          },
          valueState: "present",
          ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
          ...(entry.source === undefined ? {} : { source: entry.source }),
          ...(entry.correctedAt === undefined ? {} : { correctedAt: entry.correctedAt }),
          ...(entry.origin === undefined ? {} : { origin: {
            nodeId: NodeIdSchema.parse("crm-dates"),
            step: entry.origin.step,
            dir: entry.origin.dir,
            ...(entry.origin.system === undefined ? {} : { system: entry.origin.system }),
          } }),
        })),
      },
    }),
    "context-attempts": sectionResponse({
      section: "context-attempts",
      payload: { runId, entries: [{ label: "Attempt 1", valueRedacted: `${at(30)} · this attempt` }] },
    }),
  });
}

export const FIXTURE_CONTEXT_DATA_SECTIONS = Object.freeze({
  [FIXTURE_IDS.queuedRun]: sectionsOf(1, [
    {
      label: "Starts on",
      valueRedacted: "2026-07-15",
      fieldPath: "startsOn.value",
      observedAt: at(51),
      source: "live",
      origin: { step: "CRM dates", dir: "read", system: "crm" },
    },
    {
      label: "Invited on",
      valueRedacted: "2026-06-01",
      fieldPath: "invitedOn.value",
      observedAt: at(50),
      source: "operator",
      correctedAt: at(50),
      origin: { step: "CRM dates", dir: "read", system: "crm" },
    },
  ]),
  [FIXTURE_IDS.runningRun]: sectionsOf(2, [
    { label: "Selection", valueRedacted: "exact-match", fieldPath: "startsOn.value" },
    { label: "Active status", valueRedacted: "pending", fieldPath: "invitedOn.value" },
  ]),
  [FIXTURE_IDS.doneRun]: sectionsOf(3, [
    { label: "Selection", valueRedacted: "exact-match", fieldPath: "startsOn.value" },
    { label: "Active status", valueRedacted: "active", fieldPath: "invitedOn.value" },
  ]),
  [FIXTURE_IDS.failedRun]: sectionsOf(4, [
    { label: "Selection", valueRedacted: "exact-match", fieldPath: "startsOn.value" },
    { label: "Active status", valueRedacted: "not-reached", fieldPath: "invitedOn.value" },
  ]),
  [FIXTURE_IDS.openGateRun]: sectionsOf(5, [
    { label: "Selection", valueRedacted: "ambiguous (2 candidates)", fieldPath: "startsOn.value" },
    { label: "Active status", valueRedacted: "pending", fieldPath: "invitedOn.value" },
  ]),
  [FIXTURE_IDS.gateTypedEidRun]: sectionsOf(44, [
    { label: "Selection", valueRedacted: "name mismatch", fieldPath: "startsOn.value" },
    { label: "Active status", valueRedacted: "pending", fieldPath: "invitedOn.value" },
  ]),
  [FIXTURE_IDS.parkedRun]: sectionsOf(6, [
    { label: "Selection", valueRedacted: "exact-match", fieldPath: "startsOn.value", observedAt: at(44), source: "live" },
    { label: "Termination reason", valueRedacted: "Resign - No Reason Given", fieldPath: "invitedOn.value", observedAt: at(44), source: "derived" },
  ]),
  [FIXTURE_IDS.memberRun]: sectionsOf(31, [
    { label: "Selection", valueRedacted: "exact-match", fieldPath: "startsOn.value" },
    { label: "Active status", valueRedacted: "active", fieldPath: "invitedOn.value" },
  ]),
  [FIXTURE_IDS.groupOf13]: sectionsOf(70, [
    { label: "Selection", valueRedacted: "13 members", fieldPath: "startsOn.value" },
    { label: "Active status", valueRedacted: "mixed", fieldPath: "invitedOn.value" },
  ]),
});
