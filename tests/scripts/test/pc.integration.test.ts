import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";

it("writes a monotonic PC run duration when the wall clock moves backward", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-pc-clock-"));
  try {
    const nodeModules = join(root, "node_modules");
    mkdirSync(join(nodeModules, "vitest"), { recursive: true });
    for (const pkg of ["tsx", "zod", "esbuild"]) symlinkSync(resolve("node_modules", pkg), join(nodeModules, pkg), "junction");
    for (const file of ["scripts/test/pc.ts", "scripts/test/ci-files.ts", "scripts/test/scope-files.ts", "scripts/test/pc-source.ts",
      "src/rules/time/clock.ts", "src/rules/identity/ids.ts"]) {
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file, target);
    }
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(join(nodeModules, "vitest/vitest.mjs"), `
      import { writeFileSync } from "node:fs";
      const destination = process.argv.find(arg => arg.startsWith("--json=")).slice(7);
      writeFileSync(destination, "[]");
    `);
    writeFileSync(join(root, "wall-clock.mjs"), `
      let wall = 1793683200000;
      Date.now = () => (wall -= 60000);
    `);
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const result = spawnSync(process.execPath, ["--import", "tsx", "--import", "./wall-clock.mjs", "scripts/test/pc.ts"],
      { cwd: root, env: { ...process.env, RELAY_TEST_HOST: "fixture.invalid" }, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("no portable affected files");
    const receipts = join(root, ".work/test-pc");
    const [run] = readdirSync(receipts);
    const receipt: unknown = JSON.parse(readFileSync(join(receipts, run, "result.json"), "utf8"));
    expect(receipt).toMatchObject({ exitCode: 0, files: [], durationMs: expect.any(Number) });
    if (!receipt || typeof receipt !== "object" || !("durationMs" in receipt)) throw new Error("Missing PC receipt duration");
    expect(receipt.durationMs).toBeGreaterThanOrEqual(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
