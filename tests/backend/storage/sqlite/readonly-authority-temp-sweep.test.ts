import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { sweepLeakedReadonlyAuthorityCopies } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("removes leaked readonly authority copies only when their owner pid is dead", () => {
  const root = mkdtempSync(join(tmpdir(), "readonly-authority-sweep-"));
  roots.push(root);
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  const pid = child.pid;
  if (pid === undefined || child.status !== 0) throw new Error("child-pid-missing");
  try {
    process.kill(pid, 0);
    throw new Error("child-pid-still-alive");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
  }
  const dead = join(root, `relay-readonly-authority-pid${pid}-dead`);
  const alive = join(root, `relay-readonly-authority-pid${process.pid}-alive`);
  const unnamed = join(root, "relay-readonly-authority-no-pid");
  const legacy = join(root, `relay-readonly-authority-${String(pid)}-1234-4abc-8abc-0123456789ab`);
  mkdirSync(dead);
  mkdirSync(alive);
  mkdirSync(unnamed);
  mkdirSync(legacy);
  sweepLeakedReadonlyAuthorityCopies(root);
  expect(existsSync(dead)).toBe(false);
  expect(existsSync(alive)).toBe(true);
  expect(existsSync(unnamed)).toBe(true);
  expect(existsSync(legacy)).toBe(true);
});
