import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, vi } from "vitest";
import { z } from "zod";
import { openRelayWindow } from "../../../scripts/dev/relay.js";
import { windowsSystemRoot } from "../../../src/models/config/secrets.js";
import { observePid } from "../../../src/backend/storage/admission/process-identity.js";
import { createPrivateDirectory } from "../../../src/backend/storage/private-path.js";
import { testProcessImport } from "../../support/compiled-process.js";
import { scaledMs } from "../../support/time-scale.js";

function systemPath(name: string): string {
  const root = windowsSystemRoot(); assert.ok(root); return join(root, "System32", name);
}

describe.skipIf(process.platform !== "win32")("Windows launcher surface", () => {
  it("survives closing the launcher console and finishes a held write in its detached backend", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-console-"));
    const parent = spawn(systemPath("conhost.exe"), ["--headless", "--", process.execPath, "--import", testProcessImport(),
      fileURLToPath(new URL("../../support/processes/relay-launcher-parent.ts", import.meta.url)), root, testProcessImport()],
    { detached: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    parent.stdout.resume(); parent.stderr.resume();
    let backendPid: number | undefined;
    try {
      await vi.waitFor(() => { assert.ok(existsSync(join(root, "ready"))); }, { timeout: scaledMs(5000) });
      const owner = z.strictObject({ pid: z.number().int().positive(), consolePid: z.number().int().positive() })
        .parse(JSON.parse(readFileSync(join(root, "console.json"), "utf8")));
      const backend = z.strictObject({ pid: z.number().int().positive(), consoleProcesses: z.array(z.number().int().positive()) })
        .parse(JSON.parse(readFileSync(join(root, "child.json"), "utf8")));
      backendPid = backend.pid;
      assert.equal(owner.consolePid, parent.pid);
      parent.stdin.end();
      await vi.waitFor(() => { assert.equal(observePid(owner.pid).state, "gone"); }, { timeout: scaledMs(5000) });
      assert.equal(backend.consoleProcesses.includes(owner.pid), false, "the backend must not share the launcher's console");
      await vi.waitFor(() => { assert.ok(existsSync(join(root, "draining"))); }, { timeout: scaledMs(5000) });
      assert.equal(observePid(backendPid).state, "alive");
      assert.equal(existsSync(join(root, "committed")), false);
      writeFileSync(join(root, "release"), "release");
      await vi.waitFor(() => { assert.equal(readFileSync(join(root, "committed"), "utf8"), "drained and synced"); }, { timeout: scaledMs(5000) });
      await vi.waitFor(() => { assert.equal(observePid(backendPid!).state, "gone"); }, { timeout: scaledMs(5000) });
    } finally {
      writeFileSync(join(root, "release"), "release");
      if (!parent.stdin.writableEnded) parent.stdin.end();
      if (parent.exitCode === null && parent.signalCode === null) parent.kill();
      if (backendPid !== undefined) await vi.waitFor(() => { assert.equal(observePid(backendPid!).state, "gone"); }, { timeout: scaledMs(5000) });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains a missing-Node error until the command receives input, then returns nonzero", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-cmd-"));
    const command = fileURLToPath(new URL("../../../relay.cmd", import.meta.url));
    const child = spawn(systemPath("cmd.exe"), ["/d", "/c", command], {
      env: { ...process.env, RELAY_NODE: join(root, "missing-node.exe") }, stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.stderr.on("data", chunk => { output += String(chunk); });
    const closed = new Promise<number | null>(resolve => { child.once("close", code => { resolve(code); }); });
    try {
      await vi.waitFor(() => { assert.match(output, /Set RELAY_NODE to the full path/u); }, { timeout: scaledMs(5000) });
      assert.equal(child.exitCode, null);
      child.stdin.end("\r\n");
      assert.equal(await closed, 1);
      assert.equal(output.includes(" at "), false);
    } finally { if (!child.stdin.writableEnded) child.stdin.end("\r\n"); if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; rmSync(root, { recursive: true, force: true }); }
  });

  it("locates actual Edge and loads the app URL in its dedicated profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-edge-"));
    createPrivateDirectory(join(root, "launcher"), { mode: 0o700 });
    let loaded = false;
    const server = createServer((_request, response) => { loaded = true; response.end("<title>Relay native launcher test</title>"); });
    await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert.ok(address !== null && typeof address !== "string");
    try {
      await openRelayWindow(join(root, "launcher"), address.port);
      await vi.waitFor(() => { assert.equal(loaded, true); }, { timeout: scaledMs(5000) });
    } finally {
      await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(); }); });
      const cleanup = spawnSync(systemPath("WindowsPowerShell\\v1.0\\powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference='Stop'; $profile=[Console]::In.ReadToEnd() | ConvertFrom-Json; Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'msedge.exe' -and $_.CommandLine.Contains('--user-data-dir='+$profile) -and $_.CommandLine.Contains('--app=')} | ForEach-Object {& ($env:SystemRoot+'\\System32\\taskkill.exe') /PID $_.ProcessId /T /F; if($LASTEXITCODE -ne 0){throw 'owned-edge-cleanup-failed'}}"],
      { input: JSON.stringify(join(root, "launcher", "edge")), encoding: "utf8", windowsHide: true });
      assert.equal(cleanup.status, 0, cleanup.stderr);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
