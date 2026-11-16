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

  it("runs first in staging.yml and every other job waits on it", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/staging.yml", import.meta.url), "utf8");
    const types = workflow.match(/types:\s*\[([^\]]*)\]/u)?.[1] ?? "";
    expect(types.split(",").map((item) => item.trim())).toContain("edited");
    const jobs = workflow.split("\njobs:\n")[1] ?? "";
    const names = [...jobs.matchAll(/^ {2}([\w-]+):$/gmu)].map((match) => match[1] ?? "");
    expect(names[0]).toBe("names");
    const needs = new Map<string, string[]>();
    for (const name of names.slice(1)) {
      const body = jobs.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[\w-]+:\n/u)[0] ?? "";
      const list = body.match(/^ {4}needs:\s*(?:\[([^\]]*)\]|(\S+))/mu);
      needs.set(name, (list?.[1] ?? list?.[2] ?? "").split(",").map((item) => item.trim()).filter(Boolean));
    }
    const reachesNames = (name: string, seen = new Set<string>()): boolean => {
      if (name === "names") return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return (needs.get(name) ?? []).some((parent) => reachesNames(parent, seen));
    };
    for (const name of needs.keys()) {
      expect(reachesNames(name), name).toBe(true);
    }
  });

  it("checks.yml holds the required suites", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/checks.yml", import.meta.url), "utf8");
    const names = [...(workflow.split("\njobs:\n")[1] ?? "").matchAll(/^ {2}([\w-]+):$/gmu)].map((match) => match[1] ?? "");
    for (const required of ["static", "privacy", "unit", "integration", "architecture"]) {
      expect(names).toContain(required);
    }
  });
});
