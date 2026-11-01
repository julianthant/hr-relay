import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, mkdirSync, cpSync, symlinkSync, unlinkSync, linkSync, statSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { stageFastDuoExtension } from "../../../../src/backend/runtime/browser/fast-duo-extension.js";

describe("Fast Duo extension staging", () => {
  for (const mode of ["onboarding", "workflow"] as const) it(`stages only the ${mode} runtime, its complete import closure and license`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-fast-duo-stage-")));
    try {
      const staged = join(root, "extension");
      stageFastDuoExtension(realpathSync("fast-duo"), staged, mode);
      const manifest = JSON.parse(readFileSync(join(staged, "manifest.json"), "utf8")) as { background: { service_worker: string }; content_scripts: { js: string[] }[] };
      assert.equal(manifest.background.service_worker, mode === "onboarding" ? "src/relay-background.js" : "src/workflow-background.js");
      const checked = new Set<string>();
      const checkImports = (name: string): void => {
        if (checked.has(name)) return;
        checked.add(name);
        const source = readFileSync(join(staged, name), "utf8");
        for (const match of source.matchAll(/from ['"]\.\/(.+?)['"]/gu)) checkImports(`src/${match[1]}`);
      };
      for (const name of [manifest.background.service_worker, ...manifest.content_scripts.flatMap(script => script.js)]) checkImports(name);
      for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) assert.equal(readFileSync(join(staged, name), "utf8"), readFileSync(join("fast-duo", name), "utf8"));
      assert.equal(statSync(join(staged, "manifest.json")).mode & 0o777, 0o600);
      for (const name of ["bootstrap.json", "credentials", "src/background.js", "src/private-storage.js"]) assert.equal(existsSync(join(staged, name)), false);
      if (mode === "workflow") assert.deepEqual(readdirSync(join(staged, "src")).filter(name => /options|popup|relay-/u.test(name)), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  for (const kind of ["symlink", "hardlink"] as const) it(`refuses a ${kind} source file`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-fast-duo-unsafe-")));
    try {
      const source = join(root, "source");
      mkdirSync(join(source, "src"), { recursive: true });
      for (const name of ["workflow-manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "src/background.js", "src/workflow-background.js"]) cpSync(join(realpathSync("fast-duo"), name), join(source, name));
      const target = join(source, "src", "workflow-background.js");
      unlinkSync(target);
      if (kind === "symlink") symlinkSync(join(source, "src", "background.js"), target);
      else linkSync(join(source, "src", "background.js"), target);
      assert.throws(() => stageFastDuoExtension(source, join(root, "staged"), "workflow"));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
