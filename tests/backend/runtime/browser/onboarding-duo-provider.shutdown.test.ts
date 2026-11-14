import assert from "node:assert/strict";
import { it } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createProfileOnboardingDuoProvider, ProfileOnboardingDuoProviderError } from "../../../../src/backend/runtime/browser/onboarding-duo-provider.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { mockBrowserRootPort } from "../../../support/helpers/browser/browser-roots.js";

it("stops an unused Duo provider once and refuses any later browser launch before owner or filesystem reads", async () => {
  const provider = createProfileOnboardingDuoProvider({ browserRoot: join(tmpdir(), "unused-duo-shutdown"),
    extensionDirectory: join(tmpdir(), "unused-duo-extension"), browserRoots: mockBrowserRootPort().browserRoots,
    clock: manualClock(new Date("2026-11-03T08:00:00.000Z")), closeProofMs: 100 });
  const stopping = provider.stop();
  assert.equal(provider.stop(), stopping);
  await stopping;
  const forbidden = (): never => { throw new Error("shutdown read an owner or credential"); };
  const owner = { operationId: randomUUID(), profileId: randomUUID(), accountId: randomUUID(), generation: 1,
    assertCurrent: forbidden, readState: forbidden, reportEvent: forbidden,
    start: forbidden, cancel: forbidden, confirm: forbidden };
  await assert.rejects(provider.showBrowser(owner), error => error instanceof ProfileOnboardingDuoProviderError && error.reason === "revoked");
  assert.equal(provider.stop(), stopping);
});

it("does not launch a Duo browser when shutdown arrives during focus capture", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "duo-stop-capture-"));
  const browserRoot = join(root, "browsers"); mkdirSync(browserRoot, { mode: 0o700 });
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const roots = mockBrowserRootPort().browserRoots;
  let launches = 0;
  const forbidden = (): never => { throw new Error("unexpected browser effect"); };
  const provider = createProfileOnboardingDuoProvider({ browserRoot, extensionDirectory: join(root, "extension"),
    browserRoots: { ...roots, beginSignupLaunch() { launches++; throw new Error("launched after shutdown"); } },
    clock: manualClock(new Date("2026-11-03T08:00:00.000Z")), closeProofMs: 100,
    focus: { async captureRelay() { entered.resolve(); await release.promise; return undefined; }, show: forbidden, returnToRelay: forbidden } });
  let ownerReads = 0;
  const owner = { operationId: randomUUID(), profileId: randomUUID(), accountId: randomUUID(), generation: 1,
    assertCurrent() { ownerReads++; }, readState: forbidden, reportEvent: forbidden,
    start: forbidden, cancel: forbidden, confirm: forbidden };
  const opening = provider.showBrowser(owner);
  const refused = assert.rejects(opening, error => error instanceof ProfileOnboardingDuoProviderError && error.reason === "revoked");
  try {
    await entered.promise;
    await provider.stop();
    const before = ownerReads;
    release.resolve(); await refused;
    assert.equal(ownerReads, before); assert.equal(launches, 0);
  } finally { release.resolve(); await refused; await provider.stop(); rmSync(root, { recursive: true }); }
});
