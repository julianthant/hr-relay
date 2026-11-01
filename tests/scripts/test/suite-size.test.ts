import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "vitest";
import { measureSuiteSize } from "../../../scripts/test/suite-size.js";

describe("suite size by configured project", () => {
  it("counts suffix-selected files and lines including support, types and perf integration", () => {
    const root = mkdtempSync(join(tmpdir(), "relay-suite-size-"));
    try {
      for (const path of [
        "tests/models/module.test.ts",
        "tests/models/module.local.test.ts",
        "tests/support/helpers/helper.test.ts",
        "tests/models/module.integration.test.ts",
        "tests/models/module.local.integration.test.ts",
        "tests/types/flow-graph.integration.test.ts",
        "tests/perf/dashboard-fixture.integration.test.ts",
        "tests/perf/shape.local.test.ts",
        "tests/architecture/tooling/guard.test.ts",
        "tests/architecture/tooling/guard.local.test.ts",
        "tests/parity/reference.test.ts",
        "tests/perf/benchmark.ts",
        "tests/support/helpers/helper.ts",
        "tests/types/flow-graph.typecheck.ts",
      ]) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), "export {};\n");
      }
      assert.deepEqual(measureSuiteSize(root), [
        { family: "unit", files: 2, lines: 4, state: "active" },
        { family: "integration", files: 2, lines: 4, state: "active" },
        { family: "architecture", files: 1, lines: 2, state: "active" },
        { family: "perf", files: 1, lines: 2, state: "active" },
        { family: "local", files: 4, lines: 8, state: "active" },
      ]);
      rmSync(join(root, "tests/architecture"), { recursive: true });
      assert.throws(() => measureSuiteSize(root), /architecture: project collects no tests/u);
      rmSync(join(root, "tests"), { recursive: true });
      assert.throws(() => measureSuiteSize(root), /unit: project collects no tests/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
