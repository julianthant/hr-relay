/**
 * D312/D316 — the author-experience proof: a grouping/options-only change to
 * a workflow definition changes ONLY the definition, and the compiler carries
 * it to every generic product without another authored file.
 *
 * Two definitions share the exact same entries, binds, result and
 * presentation; they differ only in how the tuples group and label those
 * entries. The compiled graph — node ids, kinds, edges, contracts — is
 * identical byte for byte; the timeline, the start/run-modal step projection
 * and the Explorer grouping follow the definition. Nothing else in the
 * repository is consulted, which is what "change only `workflow.ts`" means.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { defineWorkflow, type AnyWorkflowEntry } from "../../src/base/workflow-definition.js";
import { descriptorRuntimeNodes } from "../../src/base/workflow.js";
import { CrmReadOnboardingRecord } from "../../src/domain/contracts/crm/read-onboarding-record.js";
import { SearchPersonOrg } from "../../src/domain/contracts/ucpath/search-person-org.js";
import { CANONICAL_FIELDS } from "../../src/domain/fields/registry.js";
import { EidSchema } from "../../src/domain/ids.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../src/domain/workflow/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { projectStartSteps } from "../../src/services/start/step-selection.js";
import { compileFixtureWorkflow } from "../fixtures/workflow-definition-fixtures.js";

const Input = z.strictObject({ emplId: EidSchema, expectedName: CANONICAL_FIELDS.fullName.schema });
const CanonicalInput = defineCanonicalInput(
  Input,
  z.strictObject({ emplId: EidSchema, expectedName: CANONICAL_FIELDS.fullName.schema }),
  [{ emplId: "10800000", expectedName: "Fixture, Person" }],
);
const ResultSchema = z.strictObject({ verified: z.boolean() });

type Grouping = (entries: Readonly<{ search: AnyWorkflowEntry; verify: AnyWorkflowEntry }>) =>
  readonly (readonly [Readonly<{ key: string; label: string }>, readonly AnyWorkflowEntry[]])[];

/** One workflow, its grouping the ONLY variable. */
function variant(id: string, code: string, grouping: Grouping) {
  return defineWorkflow({
    id,
    version: 1,
    code,
    label: "Grouping proof",
    icon: "Search",
    category: "operations",
    input: Input,
    canonicalInput: CanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input) => `eid:${input.emplId}` },
    presentation: { title: (input) => `EID ${input.emplId}` },
    scenarios: ["grouping-proof/happy"],
    role: defineWorkflowRole({ kind: "standalone" }),
    steps: ({ task, result }) => {
      const search = task({ id: "search", contract: SearchPersonOrg, label: "Search", replay: "checkpoint" }, [], ({ input }) => ({
        kind: "by-eid" as const, emplId: input.emplId,
      }));
      const verify = task({ id: "verify", contract: CrmReadOnboardingRecord, label: "Verify", replay: "checkpoint" }, [search], ({ input }) => ({
        eid: input.emplId, name: input.expectedName,
      }));
      return {
        steps: grouping({ search, verify }),
        result: result(ResultSchema, [verify], ({ outputs }) => ({ verified: outputs.verify.state === "found" })),
      };
    },
  });
}

describe("grouping/options-only change (D312/D316)", () => {
  it("changes only the definition: the compiled graph is identical while every generic grouping projection follows the tuples", () => {
    const twoGroups = compileFixtureWorkflow(variant("grouping-proof-two", "gpa", ({ search, verify }) => [
      [{ key: "search", label: "Search" }, [search]],
      [{ key: "verify", label: "Verify" }, [verify]],
    ]));
    const oneGroup = compileFixtureWorkflow(variant("grouping-proof-one", "gpb", ({ search, verify }) => [
      [{ key: "reads", label: "Reads (renamed)" }, [search, verify]],
    ]));

    const graph = (compiled: typeof twoGroups) => descriptorRuntimeNodes(compiled.descriptor).map((node) => ({
      id: String(node.id),
      kind: node.kind,
      dependsOn: node.dependsOn.map(String),
      contract: node.kind === "task" ? String(node.uses.id) : undefined,
    }));
    assert.deepEqual(graph(oneGroup), graph(twoGroups), "the executable graph does not follow grouping");
    assert.deepEqual(oneGroup.contracts, twoGroups.contracts);
    assert.deepEqual(oneGroup.storeNamespaces, twoGroups.storeNamespaces);

    // The timeline, the start/run-modal steps and the generic step projection
    // are compiled from the tuples — the one place the author wrote the change.
    assert.deepEqual(twoGroups.descriptor.timeline.map(({ key, label, nodes }) => ({ key, label, nodes: nodes.map(({ id }) => String(id)) })), [
      { key: "search", label: "Search", nodes: ["search"] },
      { key: "verify", label: "Verify", nodes: ["verify"] },
    ]);
    assert.deepEqual(oneGroup.descriptor.timeline.map(({ key, label, nodes }) => ({ key, label, nodes: nodes.map(({ id }) => String(id)) })), [
      { key: "reads", label: "Reads (renamed)", nodes: ["search", "verify"] },
    ]);
    assert.equal(twoGroups.descriptor.timelineDeclared, false, "single-entry groups keyed by node id are the default timeline");
    assert.equal(oneGroup.descriptor.timelineDeclared, true);
    assert.deepEqual(projectStartSteps(oneGroup.descriptor).map(({ key, label }) => ({ key, label })), [
      { key: "reads", label: "Reads (renamed)" },
    ]);
    assert.deepEqual(projectStartSteps(twoGroups.descriptor).map(({ key, label }) => ({ key, label })), [
      { key: "search", label: "Search" },
      { key: "verify", label: "Verify" },
    ]);
  });
});
