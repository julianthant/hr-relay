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

  it("catches a task that bypasses semantic ids and the typed driver", () => {
    const root = resolve(tmpdir(), `hrauto-ui-boundary-${String(process.pid)}-${String(Date.now())}`);
    const path = resolve(root, "src/tasks/ucpath/bad.ts");
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        'import type { Page } from "playwright";\nexport function bad(page: Page) { return page.locator("#raw"); }\n',
      );
      assert.match(auditTaskDriverBoundary(root).join("\n"), /Playwright import|raw browser/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
