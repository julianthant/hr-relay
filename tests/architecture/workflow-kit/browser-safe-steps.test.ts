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

  it("names indirect, value-aliased, re-exported and direct-child task implementations and Node built-ins, and ignores type-only imports and look-alike local functions", () => {
    const root = resolve(tmpdir(), `hrauto-browser-safe-steps-${String(process.pid)}-${String(Date.now())}`);
    const kit = 'import { defineTask } from "../../../workflow-kit/task.js";\n';
    const files = {
      "src/workflow-kit/task.ts": "export function defineTask(...parts: unknown[]): unknown { return parts; }\n",
      "src/workflows/demo/steps/check/step.ts": 'import { NODE } from "../../tasks/read.js";\nimport type { Archive } from "../../tasks/archive.js";\nexport const STEP = NODE;\n',
      "src/workflows/demo/tasks/read.ts": `${kit}import { helper } from "./helper.js";\nexport const NODE = "read";\nexport const readTask = defineTask(helper, {});\n`,
      "src/workflows/demo/tasks/helper.ts": 'export { createHash as helper } from "node:crypto";\n',
      "src/workflows/demo/tasks/archive.ts": `${kit}import JSZip from "jszip";\nexport const archiveTask = defineTask(JSZip, {});\nexport type Archive = string;\n`,
      "src/workflows/demo/steps/helper.ts": 'import { ROWS } from "../tasks/aliased.js";\nexport const HELPER = ROWS;\n',
      "src/workflows/demo/tasks/aliased.ts": `${kit}const makeTask = defineTask;\nexport const ROWS = "rows";\nexport const rowsTask = makeTask({}, {});\n`,
      "src/workflows/demo/steps/reexport.ts": 'import { SHARED } from "../tasks/reexported.js";\nexport const VIA = SHARED;\n',
      "src/workflows/demo/tasks/kit.ts": 'export { defineTask as makeTask } from "../../../workflow-kit/task.js";\n',
      "src/workflows/demo/tasks/reexported.ts": 'import { makeTask } from "./kit.js";\nexport const SHARED = "shared";\nexport const sharedTask = makeTask({}, {});\n',
      "src/workflows/demo/steps/local.ts": 'import { LOCAL } from "../tasks/local.js";\nexport const OWN = LOCAL;\n',
      "src/workflows/demo/tasks/local.ts": 'function defineTask(value: string) { return value; }\nexport const LOCAL = defineTask("local");\n',
    };
    try {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(resolve(root, path)), { recursive: true });
        writeFileSync(resolve(root, path), text);
      }
      assert.deepEqual(auditBrowserSafeSteps(root), [
        "src/workflows/demo/steps/check/step.ts: reaches task implementation src/workflows/demo/steps/check/step.ts -> src/workflows/demo/tasks/read.ts",
        "src/workflows/demo/steps/check/step.ts: reaches Node built-in node:crypto via src/workflows/demo/steps/check/step.ts -> src/workflows/demo/tasks/read.ts -> src/workflows/demo/tasks/helper.ts",
        "src/workflows/demo/steps/helper.ts: reaches task implementation src/workflows/demo/steps/helper.ts -> src/workflows/demo/tasks/aliased.ts",
        "src/workflows/demo/steps/reexport.ts: reaches task implementation src/workflows/demo/steps/reexport.ts -> src/workflows/demo/tasks/reexported.ts",
      ]);
      assert.deepEqual(auditWorkflowNodeImports(root), ["src/workflows/demo/tasks/helper.ts: imports Node built-in node:crypto"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a scan that resolves no step modules", () => {
    const root = resolve(tmpdir(), `hrauto-browser-safe-steps-empty-${String(process.pid)}-${String(Date.now())}`);
    try {
      mkdirSync(resolve(root, "src/workflows/demo/tasks"), { recursive: true });
      assert.throws(() => auditBrowserSafeSteps(root), /resolved no step modules/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
