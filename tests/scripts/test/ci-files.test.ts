import { describe, expect, it } from "vitest";
import { MACOS_FILES, SERIAL_FILES, selectCiFiles } from "../../../scripts/test/ci-files.js";

const portable = "tests/backend/runs/portable.integration.test.ts";
const integration = [portable, ...MACOS_FILES, ...SERIAL_FILES].filter(file => file.endsWith(".integration.test.ts"));
const unit = ["tests/models/portable.test.ts", "tests/backend/storage/sqlite/backup-service.test.ts"];

describe("CI file selection", () => {
  it("gives each integration file to exactly one runner", () => {
    const runs = (["ubuntu", "macos", "serial"] as const).flatMap(runner => selectCiFiles(integration, "integration", runner));
    expect(runs.sort()).toEqual([...integration].sort());
    expect(selectCiFiles(integration, "integration", "ubuntu")).toEqual([portable]);
  });

  it("splits unit files between Ubuntu and macOS", () => {
    expect(selectCiFiles(unit, "unit", "ubuntu")).toEqual(["tests/models/portable.test.ts"]);
    expect(selectCiFiles(unit, "unit", "macos")).toEqual(["tests/backend/storage/sqlite/backup-service.test.ts"]);
  });

  it("refuses a pinned file Vitest no longer lists", () => {
    expect(() => selectCiFiles([portable], "integration", "ubuntu")).toThrow(/does not list/u);
  });
});
