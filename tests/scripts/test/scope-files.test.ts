import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isDirectExecution } from "../../../scripts/test/scope-files.js";

const originalArgv = process.argv.slice();
afterEach(() => { process.argv = originalArgv.slice(); });

describe("direct script execution", () => {
  it("recognizes encoded checkout paths and relative entries", () => {
    for (const entry of ["/tmp/Relay#copy/scripts/test/suite-size.ts", "Relay copy/suite-size.ts", "Relay%copy/suite-size.ts"]) {
      process.argv[1] = entry;
      expect(isDirectExecution(pathToFileURL(resolve(entry)).href)).toBe(true);
      expect(isDirectExecution(pathToFileURL(resolve("other-script.ts")).href)).toBe(false);
    }
  });

  it("refuses an absent process entry", () => {
    process.argv.splice(1);
    expect(isDirectExecution(pathToFileURL(resolve("suite-size.ts")).href)).toBe(false);
  });
});
