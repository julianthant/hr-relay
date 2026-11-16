import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { createAutomaticRestoreBrowserRoots, createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import { StoppedBrowserRootsV1Schema } from "../../../../src/backend/storage/browser-root-contract.js";
import { restoreBrowserMembershipDigest } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { capturePredecessorRestoreFixture } from "../../../support/helpers/backend/predecessor-restore-candidate.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

const native = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("../../../../src/backend/runtime/browser/native-browser.js", async load => ({
  ...await load<typeof import("../../../../src/backend/runtime/browser/native-browser.js")>(),
  createNativeBrowserProbe(input: { signal: AbortSignal }) {
    return { signal: input.signal, async probe(_root: string, directory: string) { native.paths.push(directory); } };
  },
}));
vi.mock("../../../../src/backend/storage/maintenance/process-closure.js", async load => ({
  ...await load<typeof import("../../../../src/backend/storage/maintenance/process-closure.js")>(), proveProfileRootsUnused() {},
}));
afterEach(() => { native.paths = []; });

for (const replaced of [false, true]) it(`admits exact V1 restore custody ${replaced ? "after" : "before"} replacement across a cold lifetime`, async () => {
  const f = await capturePredecessorRestoreFixture(replaced);
  try {
    native.paths = [];
    const { admission } = f.acquire(), roots = createAutomaticRestoreBrowserRoots(admission);
    assert.throws(() => createBrowserRoots(admission).inventory());
    assert.equal(restoreBrowserMembershipDigest(admission), f.originalDigest);
    assert.deepEqual(readFileSync(f.journalPath), f.originalJournal);
    await assert.rejects(roots.probeClosed(join(f.f.stateRoot, "browsers", "foreign"), {
      signal: new AbortController().signal, async probe() { throw new Error("foreign-probe-must-not-run"); },
    }));
    assert.deepEqual(native.paths, []);
    await roots.probeClosed(f.directory, {
      signal: new AbortController().signal, async probe(_root, directory) { native.paths.push(directory); },
    });
    assert.deepEqual(native.paths, [f.directory]);
    assert.deepEqual(readFileSync(f.journalPath), f.originalJournal);
    assert.equal(restoreBrowserMembershipDigest(admission), f.originalDigest);
    assert.equal(StoppedBrowserRootsV1Schema.parse(JSON.parse(readFileSync(f.browserPath, "utf8"))).roots.length, f.prior.roots.length);
    f.release(); assert.throws(() => roots.inventory(), /released admission/u);
  } finally { await f.close(); }
});

it("refuses changed V1 membership before the native recovery boundary and preserves the captured proof", async () => {
  const f = await capturePredecessorRestoreFixture(false);
  try {
    writeFileSync(f.browserPath, canonicalJsonStringify({ ...f.prior, roots: f.prior.roots.map(row => ({ ...row, credentialFingerprint: "b".repeat(64) })) }));
    native.paths = []; f.acquire();
    await assert.rejects(f.resume(), /restore-browser-membership-changed/u);
    assert.deepEqual(native.paths, []);
    assert.deepEqual(readFileSync(f.journalPath), f.originalJournal);
    assert.equal(StoppedBrowserRootsV1Schema.parse(JSON.parse(readFileSync(f.browserPath, "utf8"))).roots[0]?.credentialFingerprint, "b".repeat(64));
  } finally { await f.close(); }
});
