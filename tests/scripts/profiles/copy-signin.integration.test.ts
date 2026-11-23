import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const credentials = {
  RELAY_EMAIL: "relay-email-sentinel@example.test",
  RELAY_PASSWORD: "relay-password-sentinel",
  UCPATH_USERNAME: "ucpath-username-sentinel",
  UCPATH_PASSWORD: "ucpath-password-sentinel",
};
// HOME moves to the fixture, so Playwright keeps the installed browsers explicitly.
const browsers = chromium.executablePath().split(`${sep}chromium-`)[0];
const sentinels = Object.values(credentials);

function leaks(text: string, root: string, skip: string): string[] {
  const found = sentinels.filter(value => text.includes(value)).map(() => "output");
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && path !== skip) {
        const bytes = readFileSync(path);
        for (const value of sentinels) if (bytes.includes(value)) found.push(path);
      }
    }
  };
  walk(root);
  return found;
}

async function launch(root: string, workspace: string): Promise<{ code: number | null; output: string }> {
  const child = spawn(process.execPath, ["--conditions=development", "--import", "tsx", "scripts/profiles/copy-signin.ts", "development", "--fixture-workspace", workspace], {
    cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: root, RELAY_RUNTIME_PROFILE: "development", PLAYWRIGHT_BROWSERS_PATH: browsers },
  });
  let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { output += String(chunk); });
  const code = await new Promise<number | null>(resolve => { child.on("close", resolve); });
  return { code, output };
}

// The launcher finds the env file through HOME, which Windows does not use.
it.skipIf(process.platform === "win32")("keeps sign-in secrets out of the real launcher's and owned backend's output and written files", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-copy-signin-fixture-")));
  try {
    const envDirectory = join(root, ".config", "relay"), envFile = join(envDirectory, "operator-signin.env");
    const workspace = join(root, "Library", "Application Support", "Relay-development");
    mkdirSync(envDirectory, { recursive: true, mode: 0o700 });
    mkdirSync(workspace, { recursive: true, mode: 0o700 });
    writeFileSync(envFile, Object.entries(credentials).map(([name, value]) => `${name}="${value}"`).join("\n"), { mode: 0o600 });
    const { code, output } = await launch(root, workspace);
    // The owned backend took the sign-up, kept its key in the fixture store and refused Duo setup before any browser launch.
    expect(output).toContain('"reason":"copy-signin-fixture-duo-refused"');
    expect(output).toContain("copy-signin-duo-unconfirmed");
    expect(code).toBe(1);
    expect(readdirSync(join(workspace, ".tracker", "fixture-keychain")).length).toBeGreaterThan(0);
    expect(existsSync(join(workspace, ".tracker", "data", "browsers", "onboarding"))).toBe(false);
    expect(leaks(output, root, envFile)).toEqual([]);
    // The scan reports a secret the launcher prints or writes anywhere under the fixture.
    writeFileSync(join(workspace, "leak.txt"), credentials.UCPATH_PASSWORD);
    expect(leaks(`${output}${credentials.RELAY_EMAIL}`, root, envFile)).toEqual(["output", join(workspace, "leak.txt")]);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);

it("refuses a fixture workspace outside the temporary root before the owned backend starts", async () => {
  const parent = join(repositoryRoot, ".work");
  mkdirSync(parent, { recursive: true });
  const root = realpathSync(mkdtempSync(join(parent, "copy-signin-fixture-")));
  try {
    const workspace = join(root, "Relay-development");
    mkdirSync(workspace);
    const child = spawn(process.execPath, ["--conditions=development", "--import", "tsx", "scripts/profiles/copy-signin.ts", "development", "--fixture-workspace", workspace], {
      cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, RELAY_RUNTIME_PROFILE: "development" },
    });
    let output = "";
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.stderr.on("data", chunk => { output += String(chunk); });
    expect(await new Promise<number | null>(resolve => { child.on("close", resolve); })).toBe(1);
    expect(output).toBe("copy-signin-target-refused\n");
    expect(readdirSync(workspace)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60_000);
