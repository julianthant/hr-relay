import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, it } from "vitest";
import { auditTaskDriverBoundary } from "./helpers/ui-boundary-audit.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

describe("task to system-driver boundary", () => {
  it("keeps Playwright and raw locator operations inside driver/session owners", () => {
    assert.deepEqual(auditTaskDriverBoundary(REPO_ROOT), []);
  });

  it("catches dynamic imports, newPage/$ bypasses, and an indirect private-driver import", () => {
    const root = resolve(tmpdir(), `hrauto-ui-boundary-${String(process.pid)}-${String(Date.now())}`);
    const path = resolve(root, "src/stores/ucpath/tasks/bad.ts");
    const helper = resolve(root, "src/stores/ucpath/helper.ts");
    const driver = resolve(root, "src/stores/ucpath/driver/interpreter.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      mkdirSync(dirname(driver), { recursive: true });
      writeFileSync(
        path,
        'import { helper } from "../unit/helper.js";\nexport async function bad(context: { newPage(): Promise<{ $(value: string): unknown }> }) { const api = await import("playwright"); const page = await context["newPage"](); page.$("#raw"); return [api, helper]; }\n',
      );
      writeFileSync(helper, 'export { helper } from "../unit/architecture/driver/interpreter.js";\n');
      writeFileSync(driver, "export const helper = true;\n");
      const issues = auditTaskDriverBoundary(root).join("\n");
      assert.match(issues, /dynamic Playwright import/);
      assert.match(issues, /newPage/);
      assert.match(issues, /\.\$/);
      assert.match(issues, /import graph reaches private raw-browser owner/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still fences tasks off from the session-factory raw-browser family", () => {
    // Widening the owner set to `src/infra/browser/**` must not make it
    // reachable: a task that imports the factory (directly or through a
    // helper) is the same ownership bypass as importing a private driver.
    const root = resolve(tmpdir(), `hrauto-ui-factory-${String(process.pid)}-${String(Date.now())}`);
    const task = resolve(root, "src/stores/ucpath/tasks/bad.ts");
    const helper = resolve(root, "src/stores/ucpath/helper.ts");
    const factory = resolve(root, "src/infra/browser/browser-session-factory.ts");
    try {
      mkdirSync(dirname(task), { recursive: true });
      mkdirSync(dirname(factory), { recursive: true });
      writeFileSync(task, 'import { open } from "../unit/helper.js";\nexport const bad = open;\n');
      writeFileSync(helper, 'export { open } from "../infra/browser/browser-session-factory.js";\n');
      writeFileSync(factory, 'import { chromium } from "playwright";\nexport const open = chromium;\n');
      const issues = auditTaskDriverBoundary(root).join("\n");
      assert.match(issues, /import graph reaches private raw-browser owner src\/infra\/browser/);
      assert.doesNotMatch(
        issues,
        /browser-session-factory\.ts: Playwright import/,
        "the factory itself is a sanctioned owner",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("catches premature capability forgery and commit implementations", () => {
    const root = resolve(tmpdir(), `hrauto-ui-capability-${String(process.pid)}-${String(Date.now())}`);
    const path = resolve(root, "src/stores/ucpath/driver/bad.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "const token = {} as MutationCapability;\nexport const driver = { commit: async () => token };\n");
      const issues = auditTaskDriverBoundary(root).join("\n");
      assert.match(issues, /cannot be minted by type assertion/);
      assert.match(issues, /a commit implementation must live in a store driver owner/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
