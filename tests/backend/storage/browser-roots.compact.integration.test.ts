import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { it } from "vitest";
import { SignUpOperationSchema } from "../../../src/models/profiles/profile.js";
import { createBrowserRoots } from "../../../src/backend/storage/browser-roots.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { seedRegisteredSignupBrowser } from "../../support/helpers/browser/browser-roots.js";

async function signupFixture() {
  const f = await createBoundProfileFixture({ pending: "onboarding" });
  assert.equal(f.draft?.state, "onboarding");
  const path = join(f.machine.stateRoot, "machine", "browser-roots.json");
  const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(f.machine.stateRoot, "machine", "operations", `${f.draft.operationId}.json`), "utf8")));
  assert.ok(operation.onboarding);
  const request = { profileId: operation.profileId, profileRoot: join(f.machine.stateRoot, "browsers", "onboarding"), credentialFingerprint: null,
    owner: { kind: "signup" as const, operationId: operation.operationId, accountId: operation.onboarding.accountId, providerGeneration: operation.onboarding.generation } };
  return { f, path, operation, request, roots: createBrowserRoots(f.machine) };
}

it("keeps the same handle on a later launch and allocates a distinct handle for the next provider generation", async () => {
  const w = await signupFixture();
  try {
    const first = w.roots.beginSignupLaunch(w.request); first.closing(); first.closed();
    const reopened = createBrowserRoots(w.f.machine).beginSignupLaunch(w.request);
    assert.equal(reopened.input.profileDirectory, first.input.profileDirectory); reopened.closing(); reopened.closed();
    assert.ok(w.operation.onboarding);
    const operation = SignUpOperationSchema.parse({ ...w.operation, onboarding: { ...w.operation.onboarding, generation: w.operation.onboarding.generation + 1 } });
    w.f.machine.publishProfileOperation(operation);
    const next = w.roots.beginSignupLaunch({ ...w.request, owner: { ...w.request.owner, providerGeneration: w.request.owner.providerGeneration + 1 } });
    assert.notEqual(next.input.profileDirectory, first.input.profileDirectory); next.closing(); next.closed();
    const rows = w.roots.inventory().roots;
    assert.deepEqual(rows.map(row => row.handle), [1, 2]); assert.deepEqual(rows.map(row => row.owner), [w.request.owner, next.input.owner]);
  } finally { await w.f.close(); }
});

it("refuses foreign profile, operation, account, generation and root substitutions before publication", async () => {
  const w = await signupFixture();
  try {
    const launch = w.roots.beginSignupLaunch(w.request); launch.closing(); launch.closed();
    const before = readFileSync(w.path);
    for (const altered of [
      { ...w.request, profileId: randomUUID() },
      { ...w.request, owner: { ...w.request.owner, operationId: randomUUID() } },
      { ...w.request, owner: { ...w.request.owner, accountId: randomUUID() } },
      { ...w.request, owner: { ...w.request.owner, providerGeneration: w.request.owner.providerGeneration + 1 } },
      { ...w.request, profileRoot: join(w.f.machine.stateRoot, "browsers", "foreign") },
    ]) {
      assert.throws(() => w.roots.beginSignupLaunch(altered));
      assert.deepEqual(readFileSync(w.path), before);
    }
    assert.throws(() => w.roots.beginLaunch({ ...launch.input, profileDirectory: join(w.request.profileRoot, "r2") }));
    assert.deepEqual(readFileSync(w.path), before);
  } finally { await w.f.close(); }
});

it("refuses an unregistered physical collision without adopting or changing its bytes", async () => {
  const w = await signupFixture();
  try {
    const target = join(w.request.profileRoot, "r1"); mkdirSync(target, { recursive: true, mode: 0o700 });
    writeFileSync(join(target, "foreign"), "retained foreign bytes", { mode: 0o600 });
    const before = readFileSync(w.path);
    assert.throws(() => w.roots.beginSignupLaunch(w.request));
    assert.deepEqual(readFileSync(w.path), before);
    assert.equal(readFileSync(join(target, "foreign"), "utf8"), "retained foreign bytes");
    assert.equal(w.roots.inventory().roots.length, 0);
  } finally { await w.f.close(); }
});

it("retires a removed handle instead of reusing its path for the same owner", async () => {
  const w = await signupFixture();
  try {
    const first = w.roots.beginSignupLaunch(w.request); first.closing(); first.closed();
    mkdirSync(first.input.profileDirectory, { recursive: true, mode: 0o700 });
    await w.roots.withUnused(first.input.profileDirectory, { signal: new AbortController().signal, async probe() {} },
      async ({ remove }) => { remove(); }, first.input);
    assert.equal(w.roots.inventory().roots.length, 0); assert.equal(w.roots.inventory().nextHandle, 2);
    const next = createBrowserRoots(w.f.machine).beginSignupLaunch(w.request); next.closing(); next.closed();
    assert.notEqual(next.input.profileDirectory, first.input.profileDirectory);
    assert.equal(w.roots.inventory().roots[0]?.handle, 2);
  } finally { await w.f.close(); }
});

it("keeps onboarding extension and Chromium paths below 220 characters with a long Windows username", async () => {
  const fixture = await createBoundProfileFixture({ pending: "onboarding" });
  try {
    const operations = join(fixture.machine.stateRoot, "machine", "operations");
    const files = readdirSync(operations).filter(name => name.endsWith(".json"));
    assert.equal(files.length, 1);
    const name = files[0]; assert.ok(name);
    const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(operations, name), "utf8")));
    seedRegisteredSignupBrowser(fixture.machine, operation);
    const row = createBrowserRoots(fixture.machine).inventory().roots[0]; assert.ok(row);
    const windowsRoot = win32.join("C:\\Users", "laptop-operator-with-a-long-username", "AppData", "Local", "Relay", ".tracker", "data");
    const browser = win32.join(windowsRoot, ...row.directory.split("/"));
    for (const suffix of [
      ["relay-extension", "src", "relay-background.js"],
      ["relay-extension", "src", "relay-content.js"],
      ["Default", "Service Worker", "ScriptCache", "index-dir", "the-real-index"],
      ["Default", "Local Extension Settings", "a".repeat(32), "000003.log"],
      ["Default", "Extensions", "a".repeat(32), "123.456.789.012_0", "_metadata", "verified_contents.json"],
    ]) {
      const length = win32.join(browser, ...suffix).length;
      assert.ok(length < 220, `onboarding path requires ${String(length)} characters; expected room below MAX_PATH`);
    }
  } finally { await fixture.close(); }
});
