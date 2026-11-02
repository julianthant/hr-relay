import { describe, expect, it } from "vitest";
import { MACOS_FILES, SERIAL_FILES, SERIAL_STORAGE_FILES } from "../../../scripts/test/ci-files.js";
import { pcSyncFiles, selectPcFiles } from "../../../scripts/test/pc.js";

describe("PC test selection", () => {
  const portable = ["tests/models/a.test.ts", "tests/backend/a.integration.test.ts", "tests/architecture/a.test.ts"];

  it("keeps affected portable files and removes every macOS list", () => {
    const native = [...new Set([...MACOS_FILES, ...SERIAL_FILES, ...SERIAL_STORAGE_FILES])];
    expect(selectPcFiles([...portable, ...native], [])).toEqual({ files: [...portable].sort(), skipped: native.sort() });
    expect(selectPcFiles([], [])).toEqual({ files: [], skipped: [] });
  });

  it("selects literal paths or quoted globs and reports macOS-only requests", () => {
    expect(selectPcFiles(portable, ["tests/backend/**/*.test.ts"]).files).toEqual([portable[1]]);
    expect(selectPcFiles([".\\tests\\models\\a.test.ts"], [portable[0]]).files).toEqual([portable[0]]);
    expect(selectPcFiles(MACOS_FILES, [MACOS_FILES[0]]).files).toEqual([]);
    expect(() => selectPcFiles(portable, ["tests/missing.test.ts"])).toThrow(/No unit, integration or architecture file/u);
  });

  it("excludes private inputs, state, dependencies and build output from sync", () => {
    expect(pcSyncFiles(["src/a.ts", ".env", ".env.local", "config/test-data.local.json", ".tracker/x", ".work/evidence", "credentials/x", ".local-private/x", "node_modules/x", "dist/x", ".git/config", ".worktrees/peer/x", "tests/fixtures/a.json"]))
      .toEqual(["src/a.ts", "tests/fixtures/a.json"]);
  });
});
