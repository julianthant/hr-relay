import { createFlowTaskFixtures } from "../support/helpers/workflow/flow-task-fixtures.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";

import {
EidSchema,
ScenarioIdSchema,
taskId
} from "../../src/rules/identity/ids.js";
import { flow } from "../../src/workflow-kit/flow.js";

const SCENARIO = ScenarioIdSchema.parse("workflow/builder-runtime");
const { INPUT, readOne, readTwo, preparePair, commitPair } = createFlowTaskFixtures(SCENARIO);

function base() {
  return flow(INPUT).step("search", readOne, {
    dependsOn: [],
    bind: ({ input }) => ({ eid: input.eid }),
    replay: "checkpoint",
  });
}

describe("workflow flow builder", () => {
  it("retains the exact node tuple in declaration order", () => {
    const built = base()
      .step("contact", readTwo, {
        dependsOn: ["search"],
        bind: ({ outputs }) => ({ eid: outputs.search.eid }),
        replay: "checkpoint",
      })
      .build({
        schema: z.object({ eid: EidSchema }),
        dependsOn: ["search"],
        derive: ({ outputs }) => ({ eid: outputs.search.eid }),
      });
    assert.deepEqual(built.nodes.map((node) => node.id), ["search", "contact"]);
    assert.deepEqual(built.nodes.map((node) => node.kind), ["task", "task"]);
    assert.equal(Object.isFrozen(built), true);
    assert.equal(Object.isFrozen(built.nodes[0]), true);
  });

  it("rejects a duplicate node id", () => {
    assert.throws(
      () => base().step("search", readTwo, {
        dependsOn: [],
        bind: ({ input }) => ({ eid: input.eid }),
        replay: "checkpoint",
      }),
      /declares node search more than once/,
    );
  });

  it("rejects a dependency on a node that is not declared upstream", () => {
    assert.throws(
      () => flow(INPUT).step("contact", readTwo, {

        dependsOn: ["search"] as never,
        bind: ({ input }) => ({ eid: input.eid }),
        replay: "checkpoint",
      }),
      /depends on search, which is not a declared upstream node/,
    );
  });

  it("rejects a repeated dependency", () => {
    assert.throws(
      () => base().step("contact", readTwo, {
        dependsOn: ["search", "search"],
        bind: ({ outputs }) => ({ eid: outputs.search.eid }),
        replay: "checkpoint",
      }),
      /repeats a dependency/,
    );
  });

  it("rejects a node id that is not kebab-case", () => {
    assert.throws(
      () => base().step("readContact", readTwo, {
        dependsOn: ["search"],
        bind: ({ outputs }) => ({ eid: outputs.search.eid }),
        replay: "checkpoint",
      }),
      /node id must be kebab-case/,
    );
  });

  it("rejects a transaction without a positive probe-to-fence budget", () => {
    for (const probeToFenceMaxMs of [0, -1, 1.5]) {
      assert.throws(
        () => base().transaction("terminate", {
          dependsOn: ["search"],
          prepare: { uses: preparePair, bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
          commit: { uses: commitPair, bind: ({ outputs }) => ({ eid: outputs.search.eid }) },
          dryRun: "stop-after-prepare",
          probePolicy: "always",
          probeToFenceMaxMs,
        }),
        /positive integer probeToFenceMaxMs budget/,
      );
    }
  });

  it("rejects a parallel node with fewer than two branches or a repeated branch id", () => {
    assert.throws(
      () => base().parallel("fan", [{ id: "a", nodes: ["search"] }], { join: "all" }),
      /requires at least two branches/,
    );
    assert.throws(
      () => base().parallel("fan", [
        { id: "a", nodes: ["search"] },
        { id: "a", nodes: ["search"] },
      ], { join: "all" }),
      /repeats a branch id/,
    );
  });

  it("requires a subscribes source exactly when the gate is not operator-resolved", () => {
    assert.throws(
      () => base().gate("signed", {
        dependsOn: ["search"],
        label: "Signed",
        resolvedBy: "external",

        subscribes: undefined as never,
        result: z.object({ ticket: z.string() }),
        resolve: () => ({ ticket: "x" }),
      }),
      /resolved by external requires a subscribes source/,
    );
    assert.throws(
      () => base().gate("approval", {
        dependsOn: ["search"],
        label: "Approve",
        resolvedBy: "operator",
        result: z.object({ approved: z.boolean() }),
        subscribes: {
          kind: "external",
          sourceId: "servicenow",
          event: z.object({ ticket: z.string() }),
          correlationKey: "ticket",
        } as never,
      }),
      /resolved by the operator cannot subscribe to a source/,
    );
  });

  it("rejects decorating a node that was never declared", () => {
    assert.throws(
      () => base().decorate("missing" as never, taskId("ucpath/search-person-org") as never, {}, "x"),
      /cannot decorate missing: no such node is declared/,
    );
  });

  it("rejects a terminal result that depends on an undeclared node, and an empty graph", () => {
    assert.throws(
      () => base().build({
        schema: z.object({ eid: EidSchema }),
        dependsOn: ["contact"] as never,
        derive: () => ({ eid: EidSchema.parse("10800000") }),
      }),
      /depends on contact, which is not a declared upstream node/,
    );
    assert.throws(
      () => flow(INPUT).build({
        schema: z.object({}),
        dependsOn: [],
        derive: () => ({}),
      }),
      /requires at least one node/,
    );
  });

  it("carries decorations and instrumentation through to the built flow", () => {
    const built = base()
      .decorate("search", taskId("ucpath/search-person-org"), {}, "audit-shot")
      .instrument({}, "span-hooks")
      .build({
        schema: z.object({ eid: EidSchema }),
        dependsOn: ["search"],
        derive: ({ outputs }) => ({ eid: outputs.search.eid }),
      });
    assert.equal(built.decorations.length, 1);
    assert.equal(built.decorations[0]?.nodeId, "search");
    assert.equal(built.decorations[0]?.contractId, "ucpath/search-person-org");
    assert.equal(built.instrumentation.length, 1);
    assert.equal(built.instrumentation[0]?.label, "span-hooks");
  });
});

describe("branch target ownership", () => {
  it("rejects a downstream target shared by two cases", () => {
    assert.throws(() => base()
      .branch("choice", { dependsOn: ["search"], choose: () => "a", cases: { a: ["shared"], b: ["shared"] } })
      .step("shared", readTwo, { dependsOn: ["search"], bind: ({ input }) => ({ eid: input.eid }), replay: "checkpoint" })
      .build({ schema: z.object({ eid: EidSchema }), dependsOn: ["shared"], derive: ({ outputs }) => ({ eid: outputs.shared.eid }) }),
    /branch choice target shared appears in more than one case/u);
  });
  for (const outerCase of ["a", "b"]) {
    it(`rejects a nested branch target shared with outer case ${outerCase}`, () => {
      assert.throws(() => base()
        .branch("outer", { dependsOn: ["search"], choose: () => "a", cases: outerCase === "a" ? { a: ["inner", "shared"], b: ["other"] } : { a: ["inner"], b: ["shared"] } })
        .branch("inner", { dependsOn: ["outer"], choose: () => "a", cases: { a: ["shared"], b: ["inner-other"] } })
        .step("shared", readTwo, { dependsOn: ["inner"], bind: ({ input }) => ({ eid: input.eid }), replay: "checkpoint" })
        .step("other", readTwo, { dependsOn: ["search"], bind: ({ input }) => ({ eid: input.eid }), replay: "checkpoint" })
        .step("inner-other", readTwo, { dependsOn: ["inner"], bind: ({ input }) => ({ eid: input.eid }), replay: "checkpoint" })
        .build({ schema: z.object({ eid: EidSchema }), dependsOn: ["search"], derive: ({ outputs }) => ({ eid: outputs.search.eid }) }),
      /branch inner target shared appears in more than one case/u);
    });
  }
  it("accepts nested branches with disjoint targets and reused case names", () => {
    assert.doesNotThrow(() => base()
      .branch("outer", { dependsOn: ["search"], choose: () => "a", cases: { a: ["inner"], b: ["other"] } })
      .branch("inner", { dependsOn: ["outer"], choose: () => "a", cases: { a: ["left"], b: ["right"] } })
      .step("left", readTwo, { dependsOn: ["inner"], bind: ({ input }) => ({ eid: input.eid }), replay: "checkpoint" })
      .step("right", readTwo, { dependsOn: ["inner"], bind: ({ input }) => ({ eid: input.eid }), replay: "checkpoint" })
      .step("other", readTwo, { dependsOn: ["search"], bind: ({ input }) => ({ eid: input.eid }), replay: "checkpoint" })
      .build({ schema: z.object({ eid: EidSchema }), dependsOn: ["search"], derive: ({ outputs }) => ({ eid: outputs.search.eid }) }));
  });
  it("accepts disjoint downstream targets", () => {
    assert.doesNotThrow(() => base()
      .branch("choice", { dependsOn: ["search"], choose: () => "a", cases: { a: ["left"], b: ["right"] } })
      .step("left", readTwo, { dependsOn: ["search"], bind: ({ input }) => ({ eid: input.eid }), replay: "checkpoint" })
      .step("right", readTwo, { dependsOn: ["search"], bind: ({ input }) => ({ eid: input.eid }), replay: "checkpoint" })
      .build({ schema: z.object({ eid: EidSchema }), dependsOn: ["search"], derive: ({ outputs }) => ({ eid: outputs.search.eid }) }));
  });
});
