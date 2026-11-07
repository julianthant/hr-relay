
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { z } from "zod";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { flow } from "../../../src/workflow-kit/flow.js";
import { deriveGraphCoveragePoints } from "../../../src/workflow-kit/validation/scenario-coverage.js";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";
import {
  FixtureCommit,
  FixtureReadReceipt,
  FixtureStage,
  fixtureDescriptor,
} from "../../support/fixtures/descriptor-fixtures.js";

const ALL = [...DESCRIPTORS, fixtureDescriptor];
const FixtureInput = z.strictObject({ eid: z.string().regex(/^10\d{6}$/) });


function commitReferenceViolations(path: string, content: string): readonly string[] {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "step" && node.arguments.length >= 2) {
      const contract = node.arguments[1];
      if (ts.isIdentifier(contract) && /commit|submit|terminate/i.test(contract.text)) {
        violations.push(`${path}: step() references ${contract.text}, which reads as a commit contract`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

describe("transaction pairing", () => {
  it("pairs prepare and commit arms from one system under one lease", () => {
    let seen = 0;
    for (const descriptor of ALL) {
      for (const node of descriptorRuntimeNodes(descriptor)) {
        if (node.kind !== "transaction") continue;
        seen += 1;
        assert.equal(node.prepare.uses.effect, "prepare", String(node.id));
        assert.equal(node.commit.uses.effect, "commit", String(node.id));
        assert.equal(node.leaseScope, "transaction", String(node.id));
        const system = (id: string) => id.slice(0, id.indexOf("/"));
        assert.equal(system(node.prepare.uses.id), system(node.commit.uses.id), String(node.id));
        assert.ok(Number.isInteger(node.probeToFenceMaxMs) && node.probeToFenceMaxMs > 0, String(node.id));
        assert.ok(["always", "retries-and-recovery-only"].includes(node.probePolicy), String(node.id));
        assert.ok(["stop-after-prepare", "unsupported"].includes(node.dryRun), String(node.id));
        // The commit contract's own recovery probe must be a read in its system.
        assert.equal(node.commit.uses.writeSafety.idempotency.probe.effect, "read", String(node.id));
        assert.equal(
          system(node.commit.uses.writeSafety.idempotency.probe.taskId),
          system(node.commit.uses.id),
          String(node.id),
        );
      }
    }
    assert.ok(seen > 0, "the sweep must actually see a transaction");
  });

  it("keeps commit.bind blind to prepare output", () => {

    for (const descriptor of ALL) {
      for (const node of descriptorRuntimeNodes(descriptor)) {
        if (node.kind !== "transaction") continue;
        assert.equal(node.prepare.bind.length, node.commit.bind.length,
          "both arms take exactly one scope argument");
        assert.ok(node.commit.bind.length <= 1, String(node.id));
      }
    }
  });

  it("rejects a non-positive probe-to-fence budget", () => {
    for (const budget of [0, -1, 1.5]) {
      assert.throws(
        () => flow(FixtureInput)
          .step("probe", FixtureReadReceipt, {
            dependsOn: [],
            replay: "checkpoint",
            bind: ({ input }) => ({ eid: input.eid }),
          })
          .transaction("submit", {
            dependsOn: ["probe"],
            prepare: { uses: FixtureStage, bind: ({ input }) => ({ eid: input.eid }) },
            commit: { uses: FixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
            dryRun: "stop-after-prepare",
            probePolicy: "always",
            probeToFenceMaxMs: budget,
          }),
        /positive integer probeToFenceMaxMs budget/,
        `budget ${String(budget)}`,
      );
    }
  });

  it("keeps commit contracts out of every standalone step across the tree", () => {
    const violations = gitVisibleFiles(["src"])
      .filter((path) => path.endsWith(".ts"))
      .flatMap((path) => commitReferenceViolations(path, readFileSync(join(REPO_ROOT, path), "utf8")));
    assert.deepEqual(violations, []);
    assert.ok(
      commitReferenceViolations("fixture.ts", 'builder.step("write", submitTermination, {});').length > 0,
      "the executable arm must catch a commit contract used as a standalone step",
    );
  });

  it("derives one scenario path per way a transaction can end", () => {
    for (const descriptor of ALL) {
      const nodes = descriptorRuntimeNodes(descriptor);
      const derived = deriveGraphCoveragePoints(nodes)
        .filter((point) => point.kind === "transaction")
        .map((point) => point.id);
      for (const node of nodes) {
        if (node.kind !== "transaction") continue;
        // Every commit can refuse a subject mismatch, settle once or find its key satisfied; preview is conditional.
        const expected = [
          ...(node.dryRun === "stop-after-prepare" ? [`transaction:${node.id}/dry-run`] : []),
          `transaction:${node.id}/subject-mismatch`,
          `transaction:${node.id}/committed`,
          `transaction:${node.id}/already-present`,
        ];
        for (const point of expected) assert.ok(derived.includes(point), `missing ${point}`);
      }
    }
  });
});
