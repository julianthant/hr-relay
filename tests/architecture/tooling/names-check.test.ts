import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nameCases, runNamesCheck } from "../../support/helpers/names-check-cases.js";

describe("names-check guard", () => {
  it.each(nameCases)("$label", ({ args, ok, offender }) => {
    const result = runNamesCheck(args);
    expect(result.error).toBeUndefined();
    const output = `${result.stdout}${result.stderr}`;
    if (ok) {
      expect(result.status).toBe(0);
      expect(output).toBe("");
      return;
    }
    expect(result.status).not.toBe(0);
    const lines = output.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(offender);
  });

  it("runs first in ci.yml and every other job waits on it", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
    const types = workflow.match(/types:\s*\[([^\]]*)\]/u)?.[1] ?? "";
    expect(types.split(",").map((item) => item.trim())).toContain("edited");
    const jobs = workflow.split("\njobs:\n")[1] ?? "";
    const names = [...jobs.matchAll(/^ {2}([\w-]+):$/gmu)].map((match) => match[1] ?? "");
    expect(names[0]).toBe("names");
    for (const required of ["static", "privacy", "unit", "integration", "architecture"]) {
      expect(names).toContain(required);
    }
    for (const name of names.slice(1)) {
      const body = jobs.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/u)[0] ?? "";
      expect(body).toMatch(/needs: (?:names\b|\[names[,\]])/u);
    }
  });
});
