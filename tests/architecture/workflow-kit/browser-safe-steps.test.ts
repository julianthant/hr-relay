import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, it } from "vitest";
import { REPO_ROOT } from "../support/helpers/guard-files.js";
import { auditBrowserSafeSteps, auditWorkflowNodeImports } from "./helpers/step-import-audit.js";

describe("browser-safe workflow steps", () => {
  it("keeps every step's runtime import graph clear of task implementations and Node built-ins", () => {
    assert.deepEqual(auditBrowserSafeSteps(REPO_ROOT), []);
  });

  it("keeps Node built-ins out of every workflow module", () => {
    assert.deepEqual(auditWorkflowNodeImports(REPO_ROOT), []);
  });

  it("names an indirect task implementation and Node built-in, and ignores type-only imports", () => {
    const root = resolve(tmpdir(), `hrauto-browser-safe-steps-${String(process.pid)}-${String(Date.now())}`);
    const files = {
      "src/workflows/demo/steps/check/step.ts": 'import { NODE } from "../../tasks/read.js";\nimport type { Archive } from "../../tasks/archive.js";\nexport const STEP = NODE;\n',
      "src/workflows/demo/tasks/read.ts": 'import { helper } from "./helper.js";\nexport const NODE = "read";\nexport const readTask = defineTask(helper, {});\n',
      "src/workflows/demo/tasks/helper.ts": 'export { createHash as helper } from "node:crypto";\n',
      "src/workflows/demo/tasks/archive.ts": 'import JSZip from "jszip";\nexport const archiveTask = defineTask(JSZip, {});\nexport type Archive = string;\n',
    };
    try {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(resolve(root, path)), { recursive: true });
        writeFileSync(resolve(root, path), text);
      }
      assert.deepEqual(auditBrowserSafeSteps(root), [
        "src/workflows/demo/steps/check/step.ts: reaches task implementation src/workflows/demo/steps/check/step.ts -> src/workflows/demo/tasks/read.ts",
        "src/workflows/demo/steps/check/step.ts: reaches Node built-in node:crypto via src/workflows/demo/steps/check/step.ts -> src/workflows/demo/tasks/read.ts -> src/workflows/demo/tasks/helper.ts",
      ]);
      assert.deepEqual(auditWorkflowNodeImports(root), ["src/workflows/demo/tasks/helper.ts: imports Node built-in node:crypto"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
