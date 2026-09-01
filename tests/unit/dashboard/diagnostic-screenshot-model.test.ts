import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { diagnosticScreenshots, initialScreenshotState, reduceScreenshot, screenshotDownloadAllowed, screenshotFilename, screenshotResourceKey, watchScreenshotRecheck } from "../../../src/dashboard/surfaces/diagnostic-screenshot-model.js";
import type { DiagnosticScreenshotLoadFailure } from "../../../src/dashboard/surfaces/trust-model.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE } from "../../parity/helpers/fixture-day.js";
import { ArtifactIdSchema, DiagnosticBundleIdSchema, FingerprintSchema } from "../../../src/domain/ids.js";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";

describe("a diagnostic screenshot resource", () => {
  it("admits no thumbnail until visible and keeps loading distinct from a decoded image", () => {
    const initial = initialScreenshotState();
    assert.equal(initial.thumbnail, "deferred");
    const loading = reduceScreenshot(initial, { type: "admit" });
    assert.equal(loading.thumbnail, "loading");
    assert.equal(reduceScreenshot(loading, { type: "loaded", view: "thumbnail" }).thumbnail, "ready");
  });

  it("keeps an attachment recheck alive across lightbox close without sharing another image's failure", () => {
    const open = reduceScreenshot(initialScreenshotState(), { type: "open" });
    const first = reduceScreenshot(open, { type: "failed" });
    const second = reduceScreenshot(initialScreenshotState(), { type: "failed" });
    const closed = reduceScreenshot(first, { type: "close" });
    assert.equal(closed.lightbox, "closed");
    assert.deepEqual(closed.authority, { state: "rechecking", request: 1 });
    assert.equal(closed.authority, first.authority, "closing the lightbox must not retrigger the parent-owned recheck effect");
    const failure = { kind: "unverified", title: "Unknown", message: "Read failed" } as const;
    const settled = reduceScreenshot(closed, { type: "rechecked", request: 1, failure });
    assert.deepEqual(settled.authority, { state: "unavailable", failure });
    assert.equal(settled.lightbox, "closed");
    assert.deepEqual(second.authority, { state: "rechecking", request: 1 });
    const reopened = reduceScreenshot(settled, { type: "open" });
    assert.deepEqual(reopened.authority, settled.authority);
  });

  it("aborts the owned fetch and ignores a delayed reread after its parent is disposed", async () => {
    const bundle = FIXTURE_DIAGNOSTIC_BUNDLE;
    const screenshot = bundle.contents.find((content) => content.kind === "screenshot");
    assert.ok(screenshot);
    const started = Promise.withResolvers<AbortSignal | null | undefined>();
    const pending = Promise.withResolvers<Response>();
    const client = createDashboardClient({
      baseUrl: "http://fixture.test",
      fetchImpl: (url, init) => {
        assert.equal(url, `http://fixture.test/api/v1/diagnostic-bundles/${bundle.bundleId}`);
        started.resolve(init?.signal);
        // Deliberately ignore abort: a late response still cannot publish.
        return pending.promise;
      },
    });
    const failures: DiagnosticScreenshotLoadFailure[] = [];
    const watch = watchScreenshotRecheck(bundle, screenshot, (id, signal) => client.diagnosticBundle(id, signal), (failure) => failures.push(failure));
    const signal = await started.promise;
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
    watch.cancel();
    assert.equal(signal.aborted, true);
    pending.resolve(Response.json(bundle));
    await watch.settled;

    assert.deepEqual(failures, []);
  });

  it("does not start a deferred read whose parent was already disposed", async () => {
    const bundle = FIXTURE_DIAGNOSTIC_BUNDLE;
    const screenshot = diagnosticScreenshots(bundle)[0];
    assert.ok(screenshot);
    const requested: string[] = [];
    const failures: DiagnosticScreenshotLoadFailure[] = [];
    const watch = watchScreenshotRecheck(bundle, screenshot, (id) => {
      requested.push(id);
      return Promise.resolve(bundle);
    }, (failure) => failures.push(failure));
    watch.cancel();
    await watch.settled;

    assert.deepEqual(requested, []);
    assert.deepEqual(failures, []);
  });

  it("offers a download only after decode or an identity-verified browser-only failure", () => {
    const loading = reduceScreenshot(initialScreenshotState(), { type: "open" });
    assert.equal(screenshotDownloadAllowed(loading), false);
    const ready = reduceScreenshot(loading, { type: "loaded", view: "lightbox" });
    assert.equal(screenshotDownloadAllowed(ready), true);
    const checking = reduceScreenshot(ready, { type: "failed" });
    assert.equal(screenshotDownloadAllowed(checking), false);
    for (const kind of ["browser", "authority", "unverified", "identity-mismatch"] as const) {
      const failed = reduceScreenshot(checking, { type: "rechecked", request: 1, failure: { kind, title: "Failure", message: "Exact outcome" } });
      assert.equal(screenshotDownloadAllowed(failed), kind === "browser");
      assert.equal(reduceScreenshot(failed, { type: "loaded", view: "lightbox" }), failed, "a late load never clears a failed authority read");
    }
  });

  it("names JPEG downloads as JPEG and PNG downloads as PNG", () => {
    assert.equal(screenshotFilename("image/jpeg", 1), "diagnostic-screenshot-2.jpg");
    assert.equal(screenshotFilename("image/png", 0), "diagnostic-screenshot-1.png");
  });

  it("refuses absent dimensions, unsupported image media or ambiguous attachment identity before rendering", () => {
    const bundle = FIXTURE_DIAGNOSTIC_BUNDLE;
    const screenshot = bundle.contents.find((content) => content.kind === "screenshot");
    assert.ok(screenshot);
    assert.equal(diagnosticScreenshots(bundle).length, 1);
    for (const change of [{ width: undefined }, { height: 0 }, { mediaType: "text/html" }]) {
      assert.throws(() => diagnosticScreenshots({ ...bundle, contents: [{ ...screenshot, ...change }] }), new RegExp(screenshot.artifactId, "u"));
    }
    assert.throws(() => diagnosticScreenshots({ ...bundle, contents: [screenshot, screenshot] }), /duplicate screenshot/u);
  });

  it("resets the resource owner when either id or its captured identity changes", () => {
    const bundle = FIXTURE_DIAGNOSTIC_BUNDLE;
    const screenshot = diagnosticScreenshots(bundle)[0];
    assert.ok(screenshot);
    const original = screenshotResourceKey(bundle, screenshot);
    for (const change of [
      { bundleId: DiagnosticBundleIdSchema.parse("00000000-0904-4000-8000-000000000999") },
      { contentDigest: FingerprintSchema.parse("a".repeat(64)) },
    ]) {
      assert.notEqual(screenshotResourceKey({ ...bundle, ...change }, screenshot), original, `bundle ${Object.keys(change).join()}`);
    }
    for (const change of [
      { artifactId: ArtifactIdSchema.parse("00000000-0904-4000-8000-000000000998") },
      { digest: FingerprintSchema.parse("c".repeat(64)) }, { byteLength: 5 }, { width: 3 }, { height: 7 },
      { mediaType: "image/jpeg" as const }, { sensitivity: "restricted" as const },
    ]) {
      assert.notEqual(screenshotResourceKey(bundle, { ...screenshot, ...change }), original, `screenshot ${Object.keys(change).join()}`);
    }
  });

  it("does not let a canceled rejection poison a later owner's successful read", async () => {
    const bundle = FIXTURE_DIAGNOSTIC_BUNDLE;
    const screenshot = diagnosticScreenshots(bundle)[0];
    assert.ok(screenshot);
    const oldResponse = Promise.withResolvers<typeof bundle>();
    const currentResponse = Promise.withResolvers<typeof bundle>();
    const oldFailures: DiagnosticScreenshotLoadFailure[] = [];
    const currentFailures: DiagnosticScreenshotLoadFailure[] = [];
    const requested: string[] = [];
    const oldStarted = Promise.withResolvers<AbortSignal | undefined>();
    const old = watchScreenshotRecheck(bundle, screenshot, (id, signal) => {
      requested.push(id);
      oldStarted.resolve(signal);
      return oldResponse.promise;
    }, (failure) => oldFailures.push(failure));
    const oldSignal = await oldStarted.promise;
    assert.ok(oldSignal instanceof AbortSignal);
    old.cancel();
    assert.equal(oldSignal.aborted, true);
    const currentStarted = Promise.withResolvers<AbortSignal | undefined>();
    const current = watchScreenshotRecheck(bundle, screenshot, (id, signal) => {
      requested.push(id);
      currentStarted.resolve(signal);
      return currentResponse.promise;
    }, (failure) => currentFailures.push(failure));
    const currentSignal = await currentStarted.promise;
    assert.ok(currentSignal instanceof AbortSignal);
    assert.notEqual(currentSignal, oldSignal);
    assert.equal(currentSignal.aborted, false);
    currentResponse.resolve(bundle);
    await current.settled;
    oldResponse.reject(new Error("late failure"));
    await old.settled;

    assert.deepEqual(oldFailures, []);
    assert.deepEqual(currentFailures.map((failure) => failure.kind), ["browser"]);
    assert.deepEqual(requested, [bundle.bundleId, bundle.bundleId]);
  });

  it("publishes live typed and unknown recheck failures without treating a thrown read as a successful verification", async () => {
    const bundle = FIXTURE_DIAGNOSTIC_BUNDLE;
    const screenshot = diagnosticScreenshots(bundle)[0];
    assert.ok(screenshot);
    const failures: DiagnosticScreenshotLoadFailure[] = [];
    const typed = watchScreenshotRecheck(bundle, screenshot, () => Promise.reject(new DashboardClientError({
      kind: "http", code: "DIAGNOSTIC_BUNDLE_BYTES_MISSING", message: "Exact bytes missing", retryable: false,
    })), (failure) => failures.push(failure));
    const unknown = watchScreenshotRecheck(bundle, screenshot, () => { throw new Error("connection failed"); }, (failure) => failures.push(failure));
    await Promise.all([typed.settled, unknown.settled]);

    assert.deepEqual(failures.map((failure) => failure.kind).sort(), ["authority", "unverified"]);
  });

  it("ignores duplicate failures, foreign request completion and late decode events while rechecking", () => {
    const checking = reduceScreenshot(initialScreenshotState(), { type: "failed" });
    assert.equal(reduceScreenshot(checking, { type: "failed" }), checking);
    assert.equal(reduceScreenshot(checking, { type: "loaded", view: "thumbnail" }), checking);
    assert.equal(reduceScreenshot(checking, {
      type: "rechecked", request: 99, failure: { kind: "browser", title: "Stale", message: "Foreign completion" },
    }), checking);
    const ready = reduceScreenshot(reduceScreenshot(initialScreenshotState(), { type: "open" }), { type: "loaded", view: "lightbox" });
    const reopened = reduceScreenshot(reduceScreenshot(ready, { type: "close" }), { type: "open" });
    assert.equal(reopened.lightbox, "loading", "a reopened image must load again, never reuse prior verified bytes");
    assert.equal(screenshotDownloadAllowed(reopened), false);
  });
});
