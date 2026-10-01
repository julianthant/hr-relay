/**
 * Transaction pairing (ref workflow-model §1.4 #7, §3.1; ref write-safety's write sequence).
 *
 * A transaction node is ONE resumable boundary containing a prepare arm and a
 * commit arm under a single page/context lease. The rules exist because of one
 * failure: a commit whose durable key depended on something read after the page
 * was already mutated cannot be probed for idempotently, so a crash between the
 * click and the confirmation becomes an unresolvable "did it land?".
 *
 * Hence: the commit arm binds from workflow input and DECLARED UPSTREAM outputs
 * only — never the ephemeral prepare output — so the key is stable before any
 * mutation; prepare and commit come from the same system; a positive
 * probe→fence budget exists so a stale preflight can never proceed to a click;
 * and no independently schedulable commit node exists anywhere in the graph.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { z } from "zod";
import { DESCRIPTORS } from "../../src/control/workflow-registry.js";
import { descriptorRuntimeNodes } from "../../src/base/workflow.js";
import { flow } from "../../src/base/flow.js";
import { deriveGraphCoveragePoints } from "../../src/domain/workflow/scenario-coverage.js";
import { gitVisibleFiles, REPO_ROOT } from "./helpers/guard-files.js";
import {
  FixtureCommit,
  FixtureReadReceipt,
  FixtureStage,
  fixtureDescriptor,
} from "../fixtures/descriptor-fixtures.js";

const ALL = [...DESCRIPTORS, fixtureDescriptor];
const FixtureInput = z.strictObject({ eid: z.string().regex(/^10\d{6}$/) });

/**
 * A commit contract may be referenced ONLY as `commit: { uses: … }`. Anywhere
 * else — a `.step(...)`, a second registry, a re-declared write gate — is the
 * "write gating re-declared per step" rot vector, and the builder's types
 * already reject it; this is the backstop for what a cast could smuggle past.
 */
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
    // Structural, not stylistic: `commit.bind` and `prepare.bind` receive the
    // SAME scope — workflow input plus declared upstream outputs. There is no
    // channel through which prepare's ephemeral output could reach the commit
    // key, so a stable durable key before any page mutation is guaranteed by
    // construction rather than by review.
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
        // dry-run only exists where a dry run is actually supported; the other
        // three are unconditional, because every commit can be refused on a
        // subject mismatch, land once, or find its key already satisfied.
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
