/**
 * `person-lookup` — the T1b LIVE-READ manifest (D318; ref guards-and-tests
 * §10.4's transaction-free arm).
 *
 * **This file is a declaration, not a test.** It is deliberately not named
 * `.test.` so no vitest project collects it, because running it starts a
 * browser and reaches live UCPath and the live CRM. It is executed by
 * `npm run cli -- dry-run-scenario person-lookup --subject <label>`, once per
 * case, and each run writes a `dry_run_scenario_results` row plus a dated line
 * in `docs/rebuild/migrations/person-lookup.md`. Its sibling
 * `structural.scenario.test.ts` is the T1a half.
 *
 * **Why `live-read` and not `dry-run-preview`.** Person Lookup's compiled
 * graph carries ZERO transaction nodes, so `workflowDryRunSupport` reports
 * `no-transaction-node` and D209 refuses `dryRun` for it — a dry run of this
 * graph would be byte-for-byte an ordinary run. D318 therefore proves T1b
 * through the ordinary path under `dryRun: false`: the runtime refuses this
 * manifest before any browser if a transaction node ever appears in the graph
 * (the manifest must then convert to the preview arm), and the positive
 * no-write proof is the exact zero delta over `write_intents`,
 * `write_attempts` and `durable_outbox`, counted by THIS run's intent set.
 * A no-op transaction added only to enter the preview arm is forbidden.
 *
 * **Subjects are LABELS.** No person's identifier appears in this file and
 * none may: `config/test-data.json` (subjects) commits only the closed reference
 * (`personLookupCanaryEid`), and the EID itself is read from ignored
 * `config/test-data.local.json` through `src/control/test-data.ts` (D341),
 * judged by the same `EidSchema` the start box applies, then fed through the
 * descriptor's OWN `inputRun` parser so
 * `keepNonHdh` and `includeCrmDates` come from the parser's declared constants.
 *
 * **What a live read of THIS workflow does.** The start box's constants set
 * `includeCrmDates: false`, so the run executes `searching` (UCPath Person
 * Org by EID), `cross-verify` (the CRM onboarding record for the resolved
 * person) and `active-status` (the pure fold), skips `crm-dates` on its
 * declared condition, and terminalizes `done` with the workflow's OWN result
 * bound to its declared result schema. The receipt below is the vocabulary
 * `buildRunEvidenceReceipt` derives for that path, pinned by the deterministic
 * composition proof in `tests/unit/dry-run-scenario-live-read.test.ts` and
 * confirmed by the dated live run recorded in the migration doc.
 */
import {
  parseDryRunScenarioManifest,
  type DryRunScenarioManifest,
} from "../../../../src/domain/trust/dry-run-scenario.js";

const CHECKPOINT_KEY = ["workflow", "item", "node", "attempt", "claimGeneration"] as const;

const READ_NODES = ["searching", "cross-verify", "active-status"] as const;

export const PERSON_LOOKUP_LIVE_READ: DryRunScenarioManifest = parseDryRunScenarioManifest({
  scenarioId: "person-lookup/live-read",
  workflow: "person-lookup",
  arm: "live-read",
  recordedBy: "R3 2026-09-02 — D318 live-read arm; receipt vocabulary pinned by the composition proof",
  cases: [
    {
      caseId: "search-by-eid",
      subjectLabel: "person-lookup-canary",
      subjectKind: "search-by-eid",
      why: "the ordinary Search mode: one current person resolved by EID, cross-verified against the CRM, folded to a verdict; the CRM dates arm stays off by the start box's declared constant",
      nodesReached: [...READ_NODES],
      nodesExcluded: ["crm-dates"],
      checkpoints: READ_NODES.map((node) => ({ node, attempt: 1, keyedBy: [...CHECKPOINT_KEY] })),
      gateResults: [],
      durableDeltas: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
      receipt: {
        result: "verified-done",
        confidence: "verified",
        verification: [
          { obligation: "node.searching", verdict: "verified", mandatory: false },
          { obligation: "node.cross-verify", verdict: "verified", mandatory: false },
          { obligation: "node.active-status", verdict: "verified", mandatory: true },
          { obligation: "node.crm-dates", verdict: "absent", mandatory: false },
          { obligation: "completion.terminal-result", verdict: "verified", mandatory: true },
          { obligation: "identity.eid-agrees-across-sources", verdict: "verified", mandatory: true },
          { obligation: "identity.ucpath-selection-is-unambiguous", verdict: "verified", mandatory: true },
        ],
      },
      terminal: { lifecycle: "done", resultSchema: "workflow-result", kind: "live-read" },
    },
  ],
});
