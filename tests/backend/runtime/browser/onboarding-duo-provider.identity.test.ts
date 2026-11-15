import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, it, vi } from "vitest";
import { mockBrowserRootPort } from "../../../support/helpers/browser/browser-roots.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createProfileOnboardingDuoProvider, ProfileOnboardingDuoProviderError } from "../../../../src/backend/runtime/browser/onboarding-duo-provider.js";
import type { DraftDuoBrowserOwner } from "../../../../src/backend/profiles/onboarding-duo.js";
import { onboardingProfileDirectory } from "../../../../src/backend/storage/browser-roots.js";

const policy = vi.hoisted(() => ({ refuse: false, observations: 0 }));
vi.mock("../../../../src/backend/storage/private-path.js", async load => ({
  ...await load<typeof import("../../../../src/backend/storage/private-path.js")>(),
  privatePathRejects(_path: string, stat: fs.Stats | fs.BigIntStats) {
    policy.observations++;
    assert.equal(typeof stat.ino, process.platform === "win32" ? "bigint" : "number");
    return policy.refuse;
  },
}));
let root: string | undefined;
afterEach(() => {
  vi.restoreAllMocks(); syncBuiltinESMExports(); policy.refuse = false; policy.observations = 0;
  if (root !== undefined) fs.rmSync(root, { recursive: true, force: true }); root = undefined;
});
function fixture() {
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "duo-root-identity-")));
  const browserRoot = join(root, "browsers"); fs.mkdirSync(browserRoot, { mode: 0o700 });
  const reached = new Error("focus-boundary-reached"), capture = vi.fn(async () => { throw reached; });
  const unexpected = () => { throw new Error("unexpected owner operation"); };
  const owner: DraftDuoBrowserOwner = { operationId: randomUUID(), profileId: randomUUID(), accountId: randomUUID(), generation: 1,
    assertCurrent() {}, readState: unexpected, reportEvent: unexpected, start: unexpected, cancel: unexpected, confirm: unexpected };
  const provider = createProfileOnboardingDuoProvider({ browserRoot, extensionDirectory: root,
    browserRoots: mockBrowserRootPort().browserRoots, clock: manualClock(new Date("2026-10-01T00:00:00Z")), closeProofMs: 50,
    focus: { captureRelay: capture, show: unexpected, returnToRelay: unexpected } });
  return { browserRoot, profileDirectory: onboardingProfileDirectory(browserRoot, 1), reached, capture, owner, provider };
}
it("uses actual Windows bigint root metadata before reaching the existing focus boundary", async () => {
  const f = fixture(); vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  const stat = vi.spyOn(fs, "lstatSync"); syncBuiltinESMExports();
  await assert.rejects(f.provider.showBrowser(f.owner), error => error instanceof ProfileOnboardingDuoProviderError && error.cause === f.reached);
  assert.equal(f.capture.mock.calls.length, 1); assert.equal(policy.observations, 1);
  assert.deepEqual(stat.mock.calls, [[f.browserRoot, { bigint: true }]]);
});
it.skipIf(process.platform === "win32")("keeps the POSIX root observation signature and public focus failure", async () => {
  const f = fixture(), stat = vi.spyOn(fs, "lstatSync"); syncBuiltinESMExports();
  await assert.rejects(f.provider.showBrowser(f.owner), error => error instanceof ProfileOnboardingDuoProviderError && error.cause === f.reached);
  assert.deepEqual(stat.mock.calls, [[f.browserRoot]]); assert.equal(f.capture.mock.calls.length, 1);
});
for (const invalid of ["policy", "file", "symlink"] as const) it(`refuses a Windows ${invalid} root before focus or browser launch`, async () => {
  const f = fixture();
  if (invalid === "file") { fs.rmdirSync(f.browserRoot); fs.writeFileSync(f.browserRoot, "synthetic file", { mode: 0o600 }); }
  if (invalid === "symlink") {
    fs.rmdirSync(f.browserRoot); fs.mkdirSync(join(root!, "target")); fs.symlinkSync(join(root!, "target"), f.browserRoot, "junction");
  }
  policy.refuse = invalid === "policy";
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  await assert.rejects(f.provider.showBrowser(f.owner), error => error instanceof ProfileOnboardingDuoProviderError && error.reason === "browser-root");
  assert.equal(f.capture.mock.calls.length, 0); assert.equal(fs.existsSync(join(f.browserRoot, "relay-extension")), false);
});
