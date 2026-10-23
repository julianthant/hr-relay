
import { z } from "zod";
import {
  compileWorkflow,
  defineWorkflow,
  type AnyCompiledWorkflow,
  type AnyWorkflowDefinition,
} from "../../../src/workflow-kit/workflow-definition.js";
import { CrmReadOnboardingDates } from "../../../src/models/systems/crm/read-onboarding-dates.js";
import { CrmReadOnboardingRecord } from "../../../src/models/systems/crm/read-onboarding-record.js";
import { UcpathDeletePendingTerminations } from "../../../src/models/systems/ucpath/delete-pending-terminations.js";
import { UcpathReadPendingTerminationSet } from "../../../src/models/systems/ucpath/read-pending-termination-set.js";
import { SearchPersonOrg } from "../../../src/models/systems/ucpath/search-person-org.js";
import { UcpathStagePendingTerminationSweep } from "../../../src/models/systems/ucpath/stage-pending-termination-sweep.js";
import { CANONICAL_FIELDS } from "../../../src/models/fields/registry.js";
import { EidSchema, FingerprintSchema, ItemIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { BUILD_MANIFEST } from "../../../src/workflow-kit/validation/build-manifest.js";
import { parseBuildManifest, type BuildManifest } from "../../../src/models/workflow/build-manifest.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import {
  PersonLookupInput,
  PersonLookupCanonicalInput,
  PersonLookupResultSchema,
} from "../../../src/workflows/person-lookup/workflow.js";

const FIXTURE_FINGERPRINT = FingerprintSchema.parse("f".repeat(64));

/** The checked-in manifest plus one entry per fixture id, so a fixture can compile. */
export function fixtureBuildManifest(ids: readonly string[]): BuildManifest {
  return parseBuildManifest({
    ...BUILD_MANIFEST,
    workflows: [
      ...BUILD_MANIFEST.workflows,
      ...ids.map((id) => ({
        id,
        fingerprint: FIXTURE_FINGERPRINT,
        sources: [{ path: `tests/unit/fixtures/${id}.fixture.ts`, sha256: FIXTURE_FINGERPRINT }],
      })),
    ],
  });
}

// Reuse one manifest identity per definition; compileWorkflow refuses a structurally equal replacement.
const FIXTURE_MANIFESTS = new Map<string, BuildManifest>();

export function compileFixtureWorkflow(definition: AnyWorkflowDefinition): AnyCompiledWorkflow {
  const id = String(definition.id);
  let manifest = FIXTURE_MANIFESTS.get(id);
  if (manifest === undefined) {
    manifest = fixtureBuildManifest([id]);
    FIXTURE_MANIFESTS.set(id, manifest);
  }
  return compileWorkflow(definition, { manifest });
}

export const EveryEntryKindInput = z.strictObject({
  emplId: EidSchema,
  expectedName: CANONICAL_FIELDS.fullName.schema,
});
export const EveryEntryKindCanonicalInput = defineCanonicalInput(
  EveryEntryKindInput,
  z.strictObject({ emplId: EidSchema, expectedName: CANONICAL_FIELDS.fullName.schema }),
  [{ emplId: "10800000", expectedName: "Fixture, Person" }],
);
export const EveryEntryKindResultSchema = z.strictObject({
  selected: z.boolean(),
  sweep: z.enum(["committed", "already-present"]),
});

const FixtureGateResultSchema = z.strictObject({ approved: z.boolean() });

export const EVERY_ENTRY_KIND_WORKFLOW_ID = "fixture-every-entry-kind";


export const everyEntryKindWorkflow = defineWorkflow({
  id: EVERY_ENTRY_KIND_WORKFLOW_ID,
  version: 1,
  code: "fek",
  label: "Every Entry Kind",
  summary: "A registry-conformance fixture that authors every explicit entry kind once.",
  icon: "Search",
  category: "operations",
  input: EveryEntryKindInput,
  canonicalInput: EveryEntryKindCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `fixture:${input.emplId}` },
  presentation: { title: (input) => `EID ${input.emplId}` },
  scenarios: ["fixture-every-entry-kind/happy"],
  role: defineWorkflowRole({ kind: "standalone" }),
  steps: ({ task, parallel, gate, delegate, transaction, result }) => {
    const search = task({
      id: "search",
      contract: SearchPersonOrg,
      label: "Search",
      replay: "checkpoint",
    }, [], ({ input }) => ({ kind: "by-eid" as const, emplId: input.emplId }));
    const crmRecord = task({
      id: "crm-record",
      contract: CrmReadOnboardingRecord,
      label: "CRM Record",
      replay: "checkpoint",
    }, [], ({ input }) => ({ eid: input.emplId, name: input.expectedName }));
    const crmDates = task({
      id: "crm-dates",
      contract: CrmReadOnboardingDates,
      label: "CRM Dates",
      replay: "checkpoint",
    }, [], ({ input }) => ({ eid: input.emplId, name: input.expectedName }));
    const fan = parallel({ id: "fan", label: "CRM reads", join: "all", failure: "fail-fast" }, [
      { id: "record", leaves: [crmRecord] },
      { id: "dates", leaves: [crmDates] },
    ]);
    const review = gate({
      id: "review",
      label: "Review",
      statusKey: "awaitingReview",
      result: FixtureGateResultSchema,
    }, [search, crmRecord]);
    const child = delegate({
      id: "child",
      label: "Child lookup",
      target: { id: WorkflowIdSchema.parse("person-lookup"), input: PersonLookupInput, result: PersonLookupResultSchema },
      edgeId: "fixture-child-lookup",
      cardinality: "one",
      await: "terminal",
      join: "one",
      policy: {
        onChildFailed: "fail-parent",
        cascadeCancel: "cascade",
        afterChildRetry: "resume-parent",
        visibility: "inline",
      },
    }, [review], {
      bind: ({ input }) => ({ emplId: input.emplId }),
      deriveChildItemId: () => ItemIdSchema.parse("00000000-0000-4000-8000-000000000fe1"),
    });
    const pendingSet = task({
      id: "pending-set",
      contract: UcpathReadPendingTerminationSet,
      label: "Pending Set",
      replay: "checkpoint",
    }, [review], ({ input }) => ({ emplId: input.emplId, expectedName: input.expectedName }));
    const sweep = transaction({
      id: "sweep",
      label: "Clear Pending",
      prepare: UcpathStagePendingTerminationSweep,
      commit: UcpathDeletePendingTerminations,
      dryRun: "stop-after-prepare",
      probePolicy: "always",
      probeToFenceMaxMs: 90_000,
    }, [pendingSet], {
      prepareBind: ({ input, outputs }) => ({
        emplId: input.emplId,
        expectedName: input.expectedName,
        observedSet: outputs["pending-set"],
      }),
      commitBind: ({ input, outputs }) => ({
        emplId: input.emplId,
        expectedName: input.expectedName,
        observedSet: outputs["pending-set"],
      }),
    });
    return {
      steps: [
        [{ key: "reads", label: "Reads" }, [search, fan]],
        [{ key: "review", label: "Review" }, [review, child]],
        [{ key: "sweep", label: "Sweep" }, [pendingSet, sweep]],
      ],
      result: result(EveryEntryKindResultSchema, [search, sweep], ({ outputs }) => ({
        selected: outputs.search.selection.selected !== null,
        sweep: outputs.sweep.disposition,
      })),
    };
  },
});

export const PARALLEL_LEAVES_WORKFLOW_ID = "fixture-parallel-leaves";
export const ParallelLeavesResultSchema = z.strictObject({ searched: z.boolean(), verified: z.boolean() });


export const parallelLeavesWorkflow = defineWorkflow({
  id: PARALLEL_LEAVES_WORKFLOW_ID,
  version: 1,
  code: "fp",
  label: "Parallel Leaves",
  icon: "Search",
  category: "operations",
  input: PersonLookupInput,
  canonicalInput: PersonLookupCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => (input.mode === "match" ? "match-fixture" : "emplId" in input ? `eid:${input.emplId}` : `name:${input.name}`) },
  presentation: { title: (input) => (input.mode === "match" ? "Match fixture" : "emplId" in input ? `EID ${input.emplId}` : input.name) },
  scenarios: ["fixture-parallel-leaves/happy"],
  role: defineWorkflowRole({ kind: "standalone" }),
  steps: ({ task, parallel, result }) => {
    const search = task({
      id: "search",
      contract: SearchPersonOrg,
      label: "Search",
      replay: "checkpoint",
    }, [], ({ input }) => (input.mode === "match" ? { kind: "by-name" as const, name: `${input.lastName}, ${input.firstName}`, keepNonHdh: false } : "emplId" in input
      ? { kind: "by-eid" as const, emplId: input.emplId }
      : { kind: "by-name" as const, name: input.name, keepNonHdh: input.keepNonHdh }));
    const verify = task({
      id: "verify",
      contract: CrmReadOnboardingRecord,
      label: "Verify",
      replay: "checkpoint",
    }, [], ({ input }) => ({
      eid: "emplId" in input ? input.emplId : "10800000",
      name: input.mode === "match" ? `${input.lastName}, ${input.firstName}` : input.name ?? "Fixture, Person",
    }));
    const fan = parallel({ id: "fan", label: "Both systems", join: "all", failure: "fail-fast" }, [
      { id: "ucpath", leaves: [search] },
      { id: "crm", leaves: [verify] },
    ]);
    return {
      steps: [[{ key: "fan", label: "Both systems" }, [fan]]],
      result: result(ParallelLeavesResultSchema, [search, verify], ({ outputs }) => ({
        searched: outputs.search.selection.selected !== null,
        verified: outputs.verify.state === "found",
      })),
    };
  },
});
