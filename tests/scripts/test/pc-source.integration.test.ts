import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildPcSource, preparePcSource } from "../../../scripts/test/pc-source.js";

it("omits tracked and untracked credential files from the patch and restores public configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-pc-credentials-"));
  try {
    const origin = join(root, "origin.git");
    const work = join(root, "checkout");
    const run = join(root, "run");
    const slot = join(root, "slot");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: work, stdio: "pipe" });
    for (const path of [join(work, "config"), run, slot]) mkdirSync(path, { recursive: true });
    git("init", "--quiet");
    git("init", "--bare", "--quiet", origin);
    git("remote", "add", "origin", origin);
    writeFileSync(join(work, "tracked.pem"), "synthetic base key");
    writeFileSync(join(work, "config/test-data.json"), "{}");
    git("add", ".");
    git("-c", "user.name=PC fixture", "-c", "user.email=pc@example.invalid", "commit", "--quiet", "-m", "synthetic base");
    git("push", "--quiet", "origin", "HEAD:refs/heads/development");
    writeFileSync(join(work, "tracked.pem"), "synthetic modified key");
    writeFileSync(join(work, "standalone.key"), "synthetic untracked key");
    writeFileSync(join(work, "staged.p12"), "synthetic staged key");
    git("add", "staged.p12");
    const publicConfig = '{"fixture":true}';
    writeFileSync(join(work, "config/test-data.json"), publicConfig);
    const source = buildPcSource(work, run);
    const paths = readFileSync(join(run, "sync-files"), "utf8");
    const patch = readFileSync(join(run, "source.patch"));
    expect(paths).toBe("config/test-data.json\0");
    expect(patch.toString()).not.toMatch(/tracked\.pem|standalone\.key|staged\.p12|synthetic .* key/u);
    writeFileSync(join(slot, "request.json"), JSON.stringify({ source }));
    writeFileSync(join(slot, "source.patch"), patch);
    preparePcSource(slot, origin);
    expect(readFileSync(join(slot, "work/config/test-data.json"), "utf8")).toBe(publicConfig);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
