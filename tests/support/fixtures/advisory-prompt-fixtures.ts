import { FailureRecordSchema } from "../../../src/models/trust/failure.js";
import { RUN_ID } from "./phase1f-run-fixtures.js";

export const ADVISORY_NOW = "2026-08-09T09:00:00.000Z";

/** The values a leak would surface. Neither may appear in a prepared prompt. */
export const LEAKY_NAME = "Battistessa, Johnnie";
export const LEAKY_EID = "10456789";

export const MAXIMAL_FAILURE = FailureRecordSchema.parse({
  failureId: "3f1c2d40-0000-4000-8000-000000000901",
  fingerprint: "ab".repeat(32),
  runId: RUN_ID,
  traceId: "pl-000619-4ebf",
  attempt: 2,
  workflowId: "person-lookup",
  nodeId: "cross-verify",
  taskId: "crm/read-person",
  code: "SUBJECT_MISMATCH",
  summary: `no candidate matched ${LEAKY_NAME} (EID ${LEAKY_EID}) on the CRM search page`,
  transient: false,
  writeState: "not-attempted",
  subject: {
    expected: { kind: "eid", digest: "cd".repeat(32), displayRedacted: `EID …${LEAKY_EID.slice(-4)}` },
    observed: { kind: "name", digest: "ef".repeat(32), displayRedacted: LEAKY_NAME },
    proofRef: "3f1c2d40-0000-4000-8000-0000000009a1",
  },
  page: {
    screen: "crm.person-search",
    state: "crm.person.results",
    urlRedacted: `https://crm.ucsd.edu/search?emplid=${LEAKY_EID}`,
    titleRedacted: `Search results — ${LEAKY_NAME}`,
  },
  action: { elementId: "crm.person.results-table", operation: "read", sequence: 3 },
  causeChain: [
    {
      code: "SUBJECT_MISMATCH",
      summary: `expected ${LEAKY_NAME} but the row named someone else`,
      role: "primary",
      transient: false,
    },
    { code: "STALE_SESSION", summary: "the CRM session had expired", role: "secondary", transient: true },
  ],
  diagnosticBundleId: "3f1c2d40-0000-4000-8000-0000000009b1",
  remediation: [
    { kind: "operator-action", message: `open CRM and confirm the EID for ${LEAKY_NAME}` },
    { kind: "retry-when-served", message: "retry once the session is fresh" },
  ],
  occurredAt: ADVISORY_NOW,
});
